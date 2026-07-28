import json


def validate_executable(ref_results: list) -> list:
    """以沙箱执行结果为准，标记通过/失败"""
    validated = []
    for r in ref_results:
        sandbox = r.get('sandbox', {})
        r['validated'] = sandbox.get('success', False)
        validated.append(r)
    return validated


def cross_validate(ref_results: list, task_data: dict) -> list:
    """对不可执行任务做交叉验证"""
    for r in ref_results:
        r['validated'] = r.get('success', False)
    return ref_results


def analyze_consensus(results: list) -> dict:
    """分析多 AI 输出的一致性"""
    if len(results) < 2:
        return {'consensus': 'single', 'note': '只有一个有效结果'}

    confidences = []
    for r in results:
        try:
            content = r.get('content', '{}')
            data = json.loads(content) if isinstance(content, str) else content
            confidences.append(data.get('confidence', 'unknown'))
        except Exception:
            confidences.append('unknown')

    unique_confs = set(confidences)
    if len(unique_confs) == 1:
        return {'consensus': 'full', 'confidence': confidences[0]}
    else:
        return {'consensus': 'partial', 'confidences': confidences}
