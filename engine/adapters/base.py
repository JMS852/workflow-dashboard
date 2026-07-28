from abc import ABC, abstractmethod
from dataclasses import dataclass


@dataclass
class AIResponse:
    content: str
    model: str
    tokens_used: int
    duration_ms: float


class AIProvider(ABC):
    _api_key: str = ''
    _enabled: bool = True
    _endpoint: str = ''

    @abstractmethod
    def chat(self, prompt: str, temperature: float = 0.3) -> AIResponse:
        ...

    @abstractmethod
    def is_available(self) -> bool:
        ...

    def configure(self, api_key: str = '', endpoint: str = '', enabled: bool = True):
        self._api_key = api_key
        self._endpoint = endpoint
        self._enabled = enabled
        self._clear_client()

    def _clear_client(self):
        """Override in subclasses that cache a client."""

    @property
    @abstractmethod
    def name(self) -> str:
        ...
