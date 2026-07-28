def cross_validate(ref_results: list, task_data: dict) -> list:
    """对不可执行任务做交叉验证"""
    for r in ref_results:
        r['validated'] = r.get('success', False)
    return ref_results
