import json
import os
import re
import time
import uuid
from ai_router import (
    call_ai, call_multiple, call_with_adversarial_verify,
    call_pipeline, get_available_providers,
)
from validator import cross_validate
from sandbox import run_in_sandbox, run_and_collect_files


def _safe_json(obj) -> str:
    """json.dumps with surrogate protection for prompt building."""
    return json.dumps(obj, ensure_ascii=False).encode('utf-8', errors='replace').decode('utf-8')

OUTPUT_SCHEMA = """{
  "answer": "你的最终答案",
  "confidence": "high/medium/low",
  "key_assumptions": ["假设1"],
  "method": "使用的方法",
  "executable": {
    "type": "code/model/table/none",
    "content": "可执行代码",
    "language": "python",
    "entry_point": "main()"
  },
  "uncertainties": ["不确定点"],
  "references": []
}"""


def classify_level(task: dict) -> str:
    """自动判定智能模式级别"""
    desc = task.get('description', '') + task.get('title', '')
    priority = task.get('priority', 'medium')

    l3_keywords = ['建模', '代码', '编程', '算法', '分析报告', '预测', '优化']
    if any(kw in desc for kw in l3_keywords) or priority == 'high':
        return 'L3'

    l2_keywords = ['文案', '撰写', '写', '报告', '表格', '整理', '翻译']
    if any(kw in desc for kw in l2_keywords):
        return 'L2'

    return 'L1'


def get_reference_models(level: str) -> list[str]:
    """根据级别获取参考 AI 列表"""
    available = get_available_providers()
    if not available:
        return []
    if level == 'L1':
        return [available[0]]
    elif level == 'L2':
        return available[:2] if len(available) >= 2 else available
    else:
        return available[:3] if len(available) >= 3 else available


def _clean_str(s: str) -> str:
    """Remove surrogates that break UTF-8 encoding."""
    if isinstance(s, str):
        return s.encode('utf-8', errors='replace').decode('utf-8')
    return s


def _clean_dict(d: dict) -> dict:
    """Recursively clean all string values in a dict."""
    if isinstance(d, dict):
        return {k: _clean_dict(v) for k, v in d.items()}
    if isinstance(d, list):
        return [_clean_dict(v) for v in d]
    if isinstance(d, str):
        return _clean_str(d)
    return d


def _extract_json(text: str) -> dict | None:
    """Extract a JSON object from AI response text that may have markdown or prose.

    Tries in order:
    1. Direct parse
    2. ```json code fence extraction
    3. First { ... } block via regex
    4. Give up → return None
    """
    if not text:
        return None
    # 1. Direct parse
    try:
        return json.loads(text)
    except (json.JSONDecodeError, TypeError):
        pass
    # 2. Extract from ```json ... ``` fence
    m = re.search(r'```(?:json)?\s*\n?(.*?)```', text, re.DOTALL)
    if m:
        try:
            return json.loads(m.group(1).strip())
        except (json.JSONDecodeError, TypeError):
            pass
    # 3. Find first balanced { ... } block
    # Use a simple brace-counting approach for reliability
    start = text.find('{')
    if start != -1:
        depth = 0
        for i in range(start, len(text)):
            if text[i] == '{':
                depth += 1
            elif text[i] == '}':
                depth -= 1
                if depth == 0:
                    try:
                        return json.loads(text[start:i + 1])
                    except (json.JSONDecodeError, TypeError):
                        break
    return None


def _extract_executable_code(content: str) -> str | None:
    """Extract executable Python code from AI response content.

    Tries JSON parsing first (executable.content field), then falls back
    to markdown code fence extraction.
    """
    if not content:
        return None
    try:
        data = json.loads(content) if isinstance(content, str) else content
        exec_field = data.get('executable', {})
        if isinstance(exec_field, dict) and exec_field.get('content'):
            return exec_field['content']
    except (json.JSONDecodeError, AttributeError):
        pass

    # Fallback: extract ```python blocks from markdown
    pattern = r'```(?:python)?\s*\n(.*?)```'
    matches = re.findall(pattern, content, re.DOTALL)
    if matches:
        return '\n\n'.join(matches)

    return None


def execute(task_data: dict, user_level: str | None = None, adversarial: bool = False) -> dict:
    """智能模式主编排器。流程：分析定级 → 分解 → 并行执行 → 验证 → 综合

    Args:
        task_data: {"title", "description", "priority", "id"}
        user_level: 手动指定 L1/L2/L3，None 则自动判定
        adversarial: True 启用对抗验证（提案 AI → 审查 AI 交叉评审 → 投票通过）
    """
    task_data = _clean_dict(task_data)
    execution_id = str(uuid.uuid4())
    level = user_level or classify_level(task_data)
    ref_models = get_reference_models(level)
    start_time = time.time()

    main_prompt = f"""你是一个任务分析专家。分析以下任务并分解为子任务。

任务标题：{task_data.get('title', '')}
任务描述：{task_data.get('description', '')}

请：
1. 判断任务类型（code/analysis/writing/other）
2. 如果是可执行类（代码/建模），生成验证脚本
3. 如果不是可执行类（文案），定义评估标准

输出 JSON：
{{
  "task_type": "code/analysis/writing/other",
  "subtasks": ["子任务描述"],
  "validation_script": "python 验证代码 或 null",
  "success_criteria": "成功标准"
}}
"""

    main_result = call_ai(main_prompt, provider='deepseek', temperature=0.2)
    plan = _extract_json(main_result) if isinstance(main_result, str) else (main_result or {})
    if not plan:
        plan = {'task_type': 'other', 'subtasks': [task_data.get('description', '')], 'validation_script': None}

    task_type = plan.get('task_type', 'other')

    execution_prompt = f"""执行以下任务，按指定格式输出。

任务：{task_data.get('title', '')}
描述：{task_data.get('description', '')}
子任务：{_safe_json(plan.get('subtasks', []))}

必须按以下 JSON Schema 输出：
{OUTPUT_SCHEMA}"""

    timeout = 180 if level == 'L3' else (120 if level == 'L2' else 60)

    if adversarial and len(ref_models) >= 2:
        # 对抗验证模式：提案 + 交叉审查 + 投票通过
        ref_results = call_with_adversarial_verify(
            execution_prompt,
            proposers=ref_models[:2],
            reviewers=ref_models[2:] if len(ref_models) > 2 else ref_models[1:],
            timeout=timeout * 2,  # 对抗验证需要更多时间（提案+审查两阶段）
        )
    else:
        ref_results = call_multiple(execution_prompt, ref_models, timeout=timeout)

    # 文件输出目录（沙箱执行时同步收集生成的文件）
    output_dir = os.path.join(os.path.expanduser('~'), 'Desktop', 'task-assistant-output')

    # 可执行验证
    if task_type in ('code', 'analysis') and plan.get('validation_script'):
        sandbox_results = []
        for r in ref_results:
            # 对抗验证模式下，只对通过审查的结果执行沙箱
            is_success = r.get('success', False)
            if adversarial:
                is_success = is_success and r.get('verdict') == 'CONFIRMED'
            if is_success:
                try:
                    result_data = json.loads(r['content']) if isinstance(r['content'], str) else r['content']
                    executable = result_data.get('executable', {})
                    if executable.get('content'):
                        exec_result = run_in_sandbox(
                            executable['content'],
                            plan['validation_script'],
                            language=executable.get('language', 'python'),
                            output_dir=output_dir,
                        )
                        sandbox_results.append({**r, 'sandbox': exec_result})
                except Exception:
                    sandbox_results.append(r)
            else:
                sandbox_results.append(r)
        ref_results = sandbox_results
    else:
        # 非代码任务做交叉验证（对抗验证结果自带审查，跳过）
        if not adversarial:
            ref_results = cross_validate(ref_results, task_data)

    # ── 文件生成：提取可执行代码并实际运行，将生成的文件保存到桌面 ──
    generated_files = []
    code_blocks_seen = set()

    # 沙箱已执行的项：直接使用 sandbox.files，避免二次执行
    for r in ref_results:
        sandbox = r.get('sandbox')
        if sandbox and sandbox.get('success') and sandbox.get('files'):
            generated_files.extend(sandbox['files'])

    for r in ref_results:
        # 跳过已有沙箱执行结果的项（文件已通过沙箱收集）
        if r.get('sandbox') and r['sandbox'].get('success'):
            continue
        if not r.get('success'):
            continue
        code = _extract_executable_code(r.get('content', ''))
        if code and code not in code_blocks_seen:
            code_blocks_seen.add(code)
            file_result = run_and_collect_files(code, output_dir)
            if file_result.get('files'):
                generated_files.extend(file_result['files'])

    # 主 AI 综合
    synthesis_prompt = f"""综合以下多个 AI 的执行结果，给出最终输出。

原始任务：{task_data.get('title', '')}

各 AI 输出：
{_safe_json([{'provider': r['provider'], 'content': r.get('content', '')[:2000], 'sandbox': r.get('sandbox', None)} for r in ref_results])}

请：
1. 如果有沙箱执行结果，以沙箱结果为准
2. 综合各 AI 的一致结论
3. 标注如果存在分歧
4. 给出最终答案和置信度

输出格式：用自然语言呈现，包含"结论"、"依据"、"注意事项"三个部分。"""

    final_result = call_ai(synthesis_prompt, provider='deepseek', temperature=0.2)
    duration_ms = int((time.time() - start_time) * 1000)

    return {
        'execution_id': execution_id,
        'level': level,
        'task_type': task_type,
        'reference_results': len(ref_results),
        'passed': sum(1 for r in ref_results if r.get('success')),
        'final_result': final_result,
        'duration_ms': duration_ms,
        'status': 'completed',
        'generated_files': generated_files,
        'output_dir': output_dir,
    }


def execute_pipeline(
    task_data: dict,
    stages: list[dict] | None = None,
    adversarial: bool = False,
    output_dir: str | None = None,
) -> dict:
    """流水线执行模式：阶段串行，上游输出驱动下游。

    对应 Harness pipeline() 模式：
    - 每个阶段独立执行，上游结果作为下游上下文
    - 每阶段有隐性阀门（gate: pass/reject）
    - reject 即中止管道，不继续下游
    - 可选对抗验证

    Args:
        task_data: {"title", "description", "priority", "id"}
        stages: 阶段列表 [{"name": "分析", "prompt": "..."}, ...]
                为空则自动从任务描述中分解
        adversarial: 每阶段是否启用对抗验证
        output_dir: 代码执行输出目录
    """
    execution_id = str(uuid.uuid4())
    start_time = time.time()

    if output_dir is None:
        output_dir = os.path.join(os.path.expanduser('~'), 'Desktop', 'task-assistant-output')

    # 自动分解 Stage plan
    if not stages:
        plan_prompt = f"""将以下任务分解为 2-4 个串行执行阶段（流水线模式）。
上游阶段的输出会传递给下游阶段作为上下文。

任务标题：{task_data.get('title', '')}
任务描述：{task_data.get('description', '')}

输出 JSON：
{{
  "stages": [
    {{"name": "阶段名称", "prompt": "该阶段的详细执行指令"}}
  ]
}}

要求：
- 阶段按依赖关系排序
- 每个阶段的 prompt 要具体、可执行
- 包含验证步骤"""
        plan_result = call_ai(plan_prompt, provider='deepseek', temperature=0.2)
        plan = _extract_json(plan_result) if isinstance(plan_result, str) else (plan_result or {})
        stages = (plan or {}).get('stages', [])
        if not stages:
            # 兜底：单阶段
            stages = [{
                'name': '执行',
                'prompt': f"执行任务：{task_data.get('description', task_data.get('title', ''))}",
            }]

    # 执行流水线
    pipeline_results = call_pipeline(stages, adversarial=adversarial)

    # 收集每阶段的 gate 和输出
    stage_summaries = []
    generated_files: list[str] = []
    all_passed = True

    for sr in pipeline_results:
        gate = sr.get('gate', 'reject')
        stage_summaries.append({
            'stage': sr['stage'],
            'gate': gate,
            'output_preview': sr.get('output', '')[:500],
        })
        if gate == 'reject':
            all_passed = False
            break

        # 提取当前阶段的可执行代码并运行
        code = _extract_executable_code(sr.get('output', ''))
        if code:
            file_result = run_and_collect_files(code, output_dir)
            if file_result.get('files'):
                generated_files.extend(file_result['files'])

    # 综合报告
    synthesis_prompt = f"""综合流水线执行结果，给出最终报告。

任务：{task_data.get('title', '')}
阶段数：{len(pipeline_results)}
阀门状态：{'全部通过' if all_passed else '有阶段被驳回'}

各阶段摘要：
{_safe_json(stage_summaries)}

各阶段输出：
{_safe_json([{'stage': r['stage'], 'output': r.get('output', '')[:2000]} for r in pipeline_results])}

请用自然语言输出最终报告，包含"执行摘要"、"各阶段结果"、"结论与下一步"。"""

    final_result = call_ai(synthesis_prompt, provider='deepseek', temperature=0.2)
    duration_ms = int((time.time() - start_time) * 1000)

    return {
        'execution_id': execution_id,
        'mode': 'pipeline',
        'level': 'L2',  # pipeline 默认 L2
        'task_type': 'pipeline',
        'stages_total': len(stages),
        'stages_passed': sum(1 for s in stage_summaries if s.get('gate') == 'pass'),
        'stage_summaries': stage_summaries,
        'all_passed': all_passed,
        'reference_results': len(pipeline_results),
        'passed': sum(1 for r in pipeline_results if r.get('gate') == 'pass'),
        'final_result': final_result,
        'duration_ms': duration_ms,
        'status': 'completed' if all_passed else 'partial',
        'generated_files': generated_files,
        'output_dir': output_dir,
    }
