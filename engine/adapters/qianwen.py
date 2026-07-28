import time
import os
from .base import AIProvider, AIResponse

try:
    from openai import OpenAI
    HAS_OPENAI = True
except ImportError:
    HAS_OPENAI = False


class QianwenProvider(AIProvider):
    name = 'qianwen'

    def __init__(self):
        self.api_key = os.environ.get('DASHSCOPE_API_KEY', '')
        self.base_url = 'https://dashscope.aliyuncs.com/compatible-mode/v1'
        self._client = None

    def _resolve_key(self):
        return self._api_key or self.api_key

    def _get_client(self):
        key = self._resolve_key()
        if not self._client and key and HAS_OPENAI:
            self._client = OpenAI(api_key=key, base_url=self._endpoint or self.base_url)
        return self._client

    def _clear_client(self):
        self._client = None

    def chat(self, prompt: str, temperature: float = 0.3) -> AIResponse:
        client = self._get_client()
        if not client:
            raise RuntimeError('Qianwen not configured')

        start = time.time()
        resp = client.chat.completions.create(
            model='qwen-plus',
            messages=[{'role': 'user', 'content': prompt}],
            temperature=temperature,
            max_tokens=4096,
        )
        elapsed = (time.time() - start) * 1000

        return AIResponse(
            content=resp.choices[0].message.content,
            model='qwen-plus',
            tokens_used=resp.usage.total_tokens if resp.usage else 0,
            duration_ms=elapsed,
        )

    def is_available(self) -> bool:
        return self._enabled and bool(self._resolve_key()) and HAS_OPENAI
