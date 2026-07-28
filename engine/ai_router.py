from __future__ import annotations

import concurrent.futures
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
    """并行调用多个 AI，收齐 2 个后再等 90s 熔断其余"""
    _init_providers()
    results = []

    with concurrent.futures.ThreadPoolExecutor(max_workers=len(providers)) as executor:
        futures = {}
        for name in providers:
            p = PROVIDERS.get(name)
            if p and p.is_available():
                futures[executor.submit(p.chat, prompt)] = name

        done_count = 0
        for future in concurrent.futures.as_completed(futures, timeout=timeout):
            name = futures[future]
            try:
                resp = future.result()
                results.append({'provider': name, 'content': _sanitize(resp.content), 'success': True})
                done_count += 1
            except Exception as e:
                results.append({'provider': name, 'content': str(e), 'success': False})

            if done_count >= 2:
                break

    return results
