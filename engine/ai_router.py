from __future__ import annotations

import concurrent.futures
import json
import re as _re_module

from adapters.deepseek import DeepSeekProvider
from adapters.qianwen import QianwenProvider
from adapters.doubao import DoubaoProvider
from adapters.hunyuan import HunyuanProvider

PROVIDERS: dict[str, object] = {}


def _sanitize(text: str) -> str:
    """Remove surrogate characters that are invalid in UTF-8."""
    return text.encode('utf-8', errors='replace').decode('utf-8')


def _init_providers():
    global PROVIDERS
    if not PROVIDERS:
        PROVIDERS = {
            'deepseek': DeepSeekProvider(),
            'qianwen': QianwenProvider(),
            'doubao': DoubaoProvider(),
            'hunyuan': HunyuanProvider(),
        }


def configure_provider(provider: str, api_key: str = '', endpoint: str = '', enabled: bool = True) -> dict:
    """接收来自 Electron 主进程的配置，动态注入 API Key"""
    _init_providers()
    p = PROVIDERS.get(provider)
    if p:
        p.configure(api_key=api_key, endpoint=endpoint, enabled=enabled)
        status = 'enabled' if enabled else 'disabled'
        return {'status': 'ok', 'provider': provider, 'state': status}
    return {'status': 'error', 'message': f'Unknown provider: {provider}'}


def get_available_providers() -> list[str]:
    _init_providers()
    return [name for name, p in PROVIDERS.items() if p.is_available()]


def call_ai(prompt: str, provider: str = 'deepseek', temperature: float = 0.3) -> str:
    """单次 AI 调用，自动降级"""
    prompt = _sanitize(prompt)
    _init_providers()
    p = PROVIDERS.get(provider)
    if not p or not p.is_available():
        available = get_available_providers()
        if not available:
            raise RuntimeError('No AI provider available')
        p = PROVIDERS[available[0]]
    return _sanitize(p.chat(prompt, temperature).content)


def call_multiple(prompt: str, providers: list[str], timeout: float = 120) -> list[dict]:
    """并行调用多个 AI，收齐 2 个即熔断其余"""
    _init_providers()
    results = []

    with concurrent.futures.ThreadPoolExecutor(max_workers=len(providers)) as executor:
        futures = {}
        for name in providers:
            p = PROVIDERS.get(name)
            if p and p.is_available():
                futures[executor.submit(p.chat, prompt)] = name

        done_count = 0
        try:
            for future in concurrent.futures.as_completed(futures, timeout=timeout):
                name = futures[future]
                try:
                    resp = future.result()
                    results.append({'provider': name, 'content': _sanitize(resp.content), 'success': True})
                    done_count += 1
                except Exception as e:
                    results.append({'provider': name, 'content': str(e), 'success': False})

                if done_count >= 2:
                    # Cancel remaining futures to implement true circuit-break
                    for f in futures:
                        f.cancel()
                    break
        except concurrent.futures.TimeoutError:
            # Collect whatever completed before timeout
            pass

    return results


def call_with_adversarial_verify(
    prompt: str,
    proposers: list[str] | None = None,
    reviewers: list[str] | None = None,
    review_threshold: int = 2,
    timeout: float = 180,
) -> list[dict]:
    """对抗验证模式：提案 AI 生成 → 审查 AI 交叉评审 → 多数通过才采纳。

    流程（对应 Harness 的 adversarial-verify 模式）：
    1. PROPOSE: N 个提案 AI 各自生成答案
    2. REVIEW:  对每个提案，M 个审查 AI 独立评审（不同 AI 审查不同维度）
    3. VOTE:    多数审查者确认 → 通过；否则驳回
    4. RETURN:  只返回通过审查的提案（dimension 字段记录审查维度结果）

    Args:
        prompt: 原始任务 prompt
        proposers: 提案 AI 列表（默认前 2 个可用 provider）
        reviewers: 审查 AI 列表（默认后 2 个可用 provider，与 proposers 不重叠）
        review_threshold: 通过门槛——至少几个审查者确认才算通过
        timeout: 总超时秒数
    """
    _init_providers()
    available = get_available_providers()
    if len(available) < 2:
        # 只有一个 provider，退回普通模式
        return call_multiple(prompt, available, timeout=min(timeout, 60))

    if proposers is None:
        # 前两个做提案
        proposers = available[:2] if len(available) >= 2 else available
    if reviewers is None:
        # 剩余做审查（确保不重叠）
        reviewers = [p for p in available if p not in proposers]
        if not reviewers:
            reviewers = [available[-1]] if available else []

    # ── Phase 1: PROPOSE ──────────────────────────────────────
    proposals: list[dict] = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=len(proposers)) as executor:
        future_map = {}
        for name in proposers:
            p = PROVIDERS.get(name)
            if p and p.is_available():
                future_map[executor.submit(p.chat, prompt)] = name

        for future in concurrent.futures.as_completed(future_map, timeout=timeout / 2):
            name = future_map[future]
            try:
                resp = future.result()
                proposals.append({
                    'provider': name,
                    'content': _sanitize(resp.content),
                    'success': True,
                    'role': 'proposer',
                })
            except Exception as e:
                proposals.append({
                    'provider': name, 'content': str(e),
                    'success': False, 'role': 'proposer',
                })

    if not proposals or not reviewers:
        return proposals

    # ── Phase 2: REVIEW each proposal ──────────────────────────
    verified: list[dict] = []

    for prop in proposals:
        if not prop['success']:
            verified.append({**prop, 'verdict': 'REJECTED', 'review_votes': 0, 'reviews': []})
            continue

        # Each reviewer independently judges this proposal
        review_prompt = f"""你是一个严格的代码审查专家（对抗验证模式）。请评审以下 AI 的输出。

原始任务：
{prompt[:2000]}

待审查的 AI 输出（来自 {prop['provider']}）：
{prop['content'][:3000]}

请从以下维度评估：
1. **正确性**：结论是否合理？有无事实错误？
2. **完整性**：是否遗漏关键点？
3. **安全性**：如有代码，是否存在安全风险？

返回 JSON：
{{"verdict": "CONFIRM" | "REJECT",
 "dimension": "正确性/完整性/安全性",
 "confidence": "high/medium/low",
 "reason": "具体理由",
 "issues": ["问题列表"]}}"""

        review_results: list[dict] = []
        with concurrent.futures.ThreadPoolExecutor(max_workers=len(reviewers)) as executor:
            review_futures = {}
            for rname in reviewers:
                rp = PROVIDERS.get(rname)
                if rp and rp.is_available():
                    review_futures[executor.submit(rp.chat, review_prompt)] = rname

            for future in concurrent.futures.as_completed(review_futures, timeout=timeout / 2):
                rname = review_futures[future]
                try:
                    resp = future.result()
                    review_results.append({
                        'reviewer': rname,
                        'content': _sanitize(resp.content),
                    })
                except Exception as e:
                    review_results.append({
                        'reviewer': rname,
                        'content': json.dumps({"verdict": "REJECT", "reason": str(e)}),
                    })

        # ── Phase 3: VOTE ──────────────────────────────────
        confirm_count = 0
        parsed_reviews = []
        for rev in review_results:
            parsed = _extract_json(rev['content'])
            parsed_reviews.append(parsed or {'verdict': 'REJECT', 'reason': 'parse error'})
            if parsed and parsed.get('verdict') == 'CONFIRM':
                confirm_count += 1

        passed = confirm_count >= review_threshold

        verified.append({
            **prop,
            'verdict': 'CONFIRMED' if passed else 'REJECTED',
            'review_votes': confirm_count,
            'review_threshold': review_threshold,
            'total_reviewers': len(review_results),
            'dimensions': [r.get('dimension', 'unknown') for r in parsed_reviews],
            'reviews': parsed_reviews,
        })

    return verified


def call_pipeline(
    stages: list[dict],
    timeout_per_stage: float = 120,
    adversarial: bool = False,
) -> list[dict]:
    """流水线模式：上游 AI 的输出作为下游 AI 的上下文。

    对应 Harness 的 pipeline() 模式：
    - 每个 stage 独立完成，不等其他 item
    - 上游结果通过 context 传递给下游
    - 每个 stage 有一道隐性阀门（gate）：输出为空则中止

    Args:
        stages: [{"name": "分析", "prompt": "..."}, {"name": "执行", "prompt": "..."}]
        timeout_per_stage: 每阶段超时
        adversarial: 是否对每阶段启用对抗验证

    Returns:
        [{"stage": "分析", "output": "...", "gate": "pass"}, ...]
    """
    _init_providers()
    available = get_available_providers()
    if not available:
        raise RuntimeError('No AI provider available')

    pipeline_results: list[dict] = []
    accumulated_context = ""

    for i, stage in enumerate(stages):
        stage_name = stage.get('name', f'stage_{i}')
        # 构建含上游上下文的 prompt
        if accumulated_context:
            full_prompt = f"""前序阶段输出：
{accumulated_context[-2000:]}

---
当前阶段任务：
{stage['prompt']}"""
        else:
            full_prompt = stage['prompt']

        # 执行当前阶段
        if adversarial and len(available) >= 2:
            proposers = [available[0]]
            reviewer_list = available[1:3] if len(available) > 1 else available
            results = call_with_adversarial_verify(
                full_prompt,
                proposers=proposers,
                reviewers=reviewer_list,
                timeout=timeout_per_stage,
            )
            # 取第一个通过验证的结果
            confirmed = [r for r in results if r.get('verdict') == 'CONFIRMED']
            if confirmed:
                output = confirmed[0]['content']
            else:
                # 没有通过验证的，退回取第一个成功的
                success_results = [r for r in results if r.get('success')]
                output = success_results[0]['content'] if success_results else ''
        else:
            output = call_ai(full_prompt, provider=available[0])

        # 隐性阀门：输出为空则中止管道
        gate = 'reject' if not output or not output.strip() else 'pass'

        stage_result = {
            'stage': stage_name,
            'output': output,
            'gate': gate,
            'index': i,
        }
        pipeline_results.append(stage_result)

        if gate == 'reject':
            break

        # 累积上下文传递给下一个阶段
        accumulated_context += f"\n[{stage_name}]\n{output[:1500]}\n"

    return pipeline_results


def _extract_json(text: str) -> dict | None:
    """从 AI 响应提取 JSON 对象（审查结果解析用）"""
    if not text:
        return None
    try:
        return json.loads(text)
    except (json.JSONDecodeError, TypeError):
        pass
    m = _re_module.search(r'```(?:json)?\s*\n?(.*?)```', text, _re_module.DOTALL)
    if m:
        try:
            return json.loads(m.group(1).strip())
        except (json.JSONDecodeError, TypeError):
            pass
    start = text.find('{')
    if start != -1:
        depth = 0
        for i in range(start, len(text)):
            if text[i] == '{': depth += 1
            elif text[i] == '}':
                depth -= 1
                if depth == 0:
                    try:
                        return json.loads(text[start:i + 1])
                    except (json.JSONDecodeError, TypeError):
                        break
    return None
