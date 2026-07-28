import json
import os
import re
import time
import uuid
from ai_router import call_ai, call_multiple, get_available_providers
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


def execute(task_data: dict, user_level: str | None = None) -> dict:
    """智能模式主编排器。流程：分析定级 → 分解 → 并行执行 → 验证 → 综合"""
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
    ref_results = call_multiple(execution_prompt, ref_models, timeout=timeout)

    # 可执行验证
    if task_type in ('code', 'analysis') and plan.get('validation_script'):
        sandbox_results = []
        for r in ref_results:
            if r['success']:
                try:
                    result_data = json.loads(r['content']) if isinstance(r['content'], str) else r['content']
                    executable = result_data.get('executable', {})
                    if executable.get('content'):
                        exec_result = run_in_sandbox(
                            executable['content'],
                            plan['validation_script'],
                            language=executable.get('language', 'python')
                        )
                        sandbox_results.append({**r, 'sandbox': exec_result})
                except Exception:
                    sandbox_results.append(r)
            else:
                sandbox_results.append(r)
        ref_results = sandbox_results
    else:
        ref_results = cross_validate(ref_results, task_data)

    # ── 文件生成：提取可执行代码并实际运行，将生成的文件保存到桌面 ──
    output_dir = os.path.join(os.path.expanduser('~'), 'Desktop', 'task-assistant-output')
    generated_files = []
    code_blocks_seen = set()

    for r in ref_results:
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
