"""Arch Tools Python SDK — Main Client"""
import requests
import json
from typing import Optional, Dict, Any
from .exceptions import ArchToolsError, RateLimitError, PaymentRequiredError

class ArchTools:
    """
    Official Python client for the Arch Tools API.
    
    Usage:
        from arch_tools import ArchTools
        client = ArchTools(api_key="arch_your_key_here")
        result = client.ai_generate(prompt="Summarize this article")
    """
    
    BASE_URL = "https://arch-ai-tools.onrender.com/v1"
    
    def __init__(self, api_key: str, base_url: Optional[str] = None):
        self.api_key = api_key
        self.base_url = base_url or self.BASE_URL
        self.session = requests.Session()
        self.session.headers.update({
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "User-Agent": "arch-tools-python/0.1.0"
        })
    
    def _call(self, tool: str, **kwargs) -> Dict[str, Any]:
        resp = self.session.post(f"{self.base_url}/tools/{tool}", json=kwargs)
        if resp.status_code == 402:
            raise PaymentRequiredError(resp.json())
        if resp.status_code == 429:
            raise RateLimitError(resp.json(), resp.headers)
        if not resp.ok:
            raise ArchToolsError(resp.json())
        return resp.json()
    
    # --- AI Tools ---
    def ai_generate(self, prompt: str, model: str = "claude", **kwargs) -> Dict:
        return self._call("ai-generate", prompt=prompt, model=model, **kwargs)
    
    # --- Web Tools ---
    def web_scrape(self, url: str, format: str = "markdown", **kwargs) -> Dict:
        return self._call("web-scrape", url=url, format=format, **kwargs)
    
    def search_web(self, query: str, limit: int = 10) -> Dict:
        return self._call("search-web", query=query, limit=limit)
    
    def screenshot_capture(self, url: str, **kwargs) -> Dict:
        return self._call("screenshot-capture", url=url, **kwargs)
    
    # --- Crypto Tools ---
    def crypto_price(self, symbol: str) -> Dict:
        return self._call("crypto-price", symbol=symbol)
    
    def crypto_market_cap(self, limit: int = 10) -> Dict:
        return self._call("crypto-market-cap", limit=limit)
    
    # --- Utility Tools ---
    def generate_hash(self, text: str, algorithm: str = "sha256") -> Dict:
        return self._call("generate-hash", text=text, algorithm=algorithm)
    
    def generate_uuid(self, count: int = 1) -> Dict:
        return self._call("generate-uuid", count=count)
    
    def email_verify(self, email: str) -> Dict:
        return self._call("email-verify", email=email)
    
    def summarize(self, text: str, style: str = "bullets") -> Dict:
        return self._call("summarize", text=text, style=style)
    
    def sentiment_analysis(self, text: str) -> Dict:
        return self._call("sentiment-analysis", text=text)
    
    def ocr_extract(self, image_url: str) -> Dict:
        return self._call("ocr-extract", image_url=image_url)
    
    # --- Generic call ---
    def call(self, tool: str, **kwargs) -> Dict:
        """Call any Arch Tools tool by name."""
        return self._call(tool, **kwargs)
    
    # --- Account ---
    def balance(self) -> Dict:
        resp = self.session.get(f"{self.base_url}/agent/balance")
        if not resp.ok:
            raise ArchToolsError(resp.json())
        return resp.json()
