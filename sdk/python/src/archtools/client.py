"""Arch Tools Python SDK — typed client for all tools."""

import os
import time
from typing import Any, Dict, List, Optional

import requests
from requests.adapters import HTTPAdapter

try:
    from urllib3.util.retry import Retry
except Exception:  # pragma: no cover
    Retry = None  # type: ignore


class ArchToolsError(Exception):
    """Raised when an API call fails."""

    def __init__(self, message: str, status_code: Optional[int] = None, detail: Optional[str] = None):
        super().__init__(message)
        self.status_code = status_code
        self.detail = detail


class ArchTools:
    """Typed client for the Arch Tools API.

    Usage::

        from archtools import ArchTools

        arch = ArchTools(api_key="arch_...")
        result = arch.search_web(query="AI news")
        print(result)
    """

    def __init__(
        self,
        api_key: str,
        base_url: Optional[str] = None,
        timeout: int = 20,
        max_retries: int = 2,
        backoff_factor: float = 0.4,
    ):
        self.api_key = api_key
        if base_url is None:
            base_url = (
                os.environ.get("ARCHTOOLS_BASE_URL")
                or os.environ.get("ARCH_API_BASE_URL")
                or "https://archtools.dev"
            )
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

        # Requests session with retry logic
        self.session = requests.Session()
        if Retry is not None and max_retries and max_retries > 0:
            retry = Retry(
                total=max_retries,
                connect=max_retries,
                read=max_retries,
                status=max_retries,
                backoff_factor=backoff_factor,
                status_forcelist=(429, 500, 502, 503, 504),
                allowed_methods=frozenset(["GET", "POST", "PUT", "PATCH", "DELETE"]),
                respect_retry_after_header=True,
                raise_on_status=False,
            )
            adapter = HTTPAdapter(max_retries=retry)
            self.session.mount("https://", adapter)
            self.session.mount("http://", adapter)

    # ─── Internal helpers ────────────────────────────────────────────────

    def _headers(self) -> Dict[str, str]:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

    def _request(
        self,
        method: str,
        path: str,
        json_body: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        url = f"{self.base_url}{path}"
        r = self.session.request(
            method=method,
            url=url,
            json=json_body,
            headers=self._headers() if self.api_key else {"Content-Type": "application/json"},
            timeout=self.timeout,
        )

        # Manual Retry-After handling (best-effort on top of urllib3 retries)
        if r.status_code == 429:
            ra = r.headers.get("Retry-After")
            if ra:
                try:
                    time.sleep(min(10, float(ra)))
                except Exception:
                    pass

        if not r.ok:
            try:
                body = r.json()
                error_msg = body.get("error", body.get("message", f"HTTP {r.status_code}"))
                detail = body.get("detail") or body.get("message")
            except Exception:
                error_msg = f"HTTP {r.status_code}"
                detail = r.text[:500] if r.text else None
            raise ArchToolsError(error_msg, status_code=r.status_code, detail=detail)

        return r.json()

    # ─── Generic tool call ───────────────────────────────────────────────

    def call_tool(self, tool_name: str, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Call any tool by name with arbitrary params."""
        return self._request("POST", f"/v1/tools/{tool_name}", params or {})

    # ─── AI tools ────────────────────────────────────────────────────────

    def ai_generate(
        self,
        prompt: str,
        model: Optional[str] = None,
        mode: Optional[str] = None,
        system: Optional[str] = None,
        max_tokens: Optional[int] = None,
    ) -> Dict[str, Any]:
        """Generate text with AI. Supports mode presets (fast/smart/deep) or explicit model."""
        body: Dict[str, Any] = {"prompt": prompt}
        if model is not None:
            body["model"] = model
        if mode is not None:
            body["mode"] = mode
        if system is not None:
            body["system"] = system
        if max_tokens is not None:
            body["max_tokens"] = max_tokens
        return self._request("POST", "/v1/tools/ai-generate", body)

    def ai_oracle(
        self,
        question: str,
        context: Optional[str] = None,
        reasoning_depth: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Deep reasoning with AI Oracle. Tries Opus → GPT-4o fallback."""
        body: Dict[str, Any] = {"question": question}
        if context is not None:
            body["context"] = context
        if reasoning_depth is not None:
            body["reasoning_depth"] = reasoning_depth
        return self._request("POST", "/v1/tools/ai-oracle", body)

    # ─── Web tools ───────────────────────────────────────────────────────

    def web_scrape(
        self,
        url: str,
        format: Optional[str] = None,
        selector: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Scrape a web page and extract text/HTML content."""
        body: Dict[str, Any] = {"url": url}
        if format is not None:
            body["format"] = format
        if selector is not None:
            body["selector"] = selector
        return self._request("POST", "/v1/tools/web-scrape", body)

    def search_web(
        self,
        query: str,
        max_results: Optional[int] = None,
    ) -> Dict[str, Any]:
        """Search the web and return structured results."""
        body: Dict[str, Any] = {"query": query}
        if max_results is not None:
            body["num_results"] = max_results
        return self._request("POST", "/v1/tools/search-web", body)

    def screenshot(
        self,
        url: str,
        full_page: Optional[bool] = None,
        width: Optional[int] = None,
        height: Optional[int] = None,
    ) -> Dict[str, Any]:
        """Take a screenshot of a web page."""
        body: Dict[str, Any] = {"url": url}
        if full_page is not None:
            body["full_page"] = full_page
        if width is not None:
            body["width"] = width
        if height is not None:
            body["height"] = height
        return self._request("POST", "/v1/tools/screenshot-capture", body)

    # ─── Text tools ──────────────────────────────────────────────────────

    def summarize(
        self,
        text: str,
        style: Optional[str] = None,
        max_length: Optional[int] = None,
    ) -> Dict[str, Any]:
        """Summarize text in various styles (paragraph/bullets/tldr/headline/executive)."""
        body: Dict[str, Any] = {"text": text}
        if style is not None:
            body["style"] = style
        if max_length is not None:
            body["max_length"] = max_length
        return self._request("POST", "/v1/tools/summarize", body)

    # ─── Vector tools ────────────────────────────────────────────────────

    def vector_store(
        self,
        content: str,
        namespace: str,
        metadata: Optional[Dict[str, str]] = None,
    ) -> Dict[str, Any]:
        """Store content in a vector namespace for later retrieval."""
        body: Dict[str, Any] = {"content": content, "namespace": namespace}
        if metadata is not None:
            body["metadata"] = metadata
        return self._request("POST", "/v1/tools/vector-store", body)

    def vector_search(
        self,
        query: str,
        namespace: str,
        top_k: Optional[int] = None,
    ) -> Dict[str, Any]:
        """Search a vector namespace by semantic similarity."""
        body: Dict[str, Any] = {"query": query, "namespace": namespace}
        if top_k is not None:
            body["top_k"] = top_k
        return self._request("POST", "/v1/tools/vector-search", body)

    # ─── Session / Conversation ──────────────────────────────────────────

    def session_create(
        self,
        namespace: str,
        system_prompt: Optional[str] = None,
        model: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Create a conversation session."""
        body: Dict[str, Any] = {"namespace": namespace}
        if system_prompt is not None:
            body["system_prompt"] = system_prompt
        if model is not None:
            body["model"] = model
        return self._request("POST", "/v1/tools/session-create", body)

    def session_message(
        self,
        session_id: str,
        message: str,
    ) -> Dict[str, Any]:
        """Send a message in an existing session."""
        return self._request("POST", "/v1/tools/session-message", {
            "session_id": session_id,
            "message": message,
        })

    # ─── Utility methods ─────────────────────────────────────────────────

    def tools_list(self) -> Dict[str, Any]:
        """List all available tools."""
        return self._request("GET", "/v1/tools")

    def agent_usage(self) -> Dict[str, Any]:
        """Get current agent usage and credit balance."""
        return self._request("GET", "/v1/agent/usage")

    def invoke(self, tool_name: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        """Alias for call_tool — invoke a tool by name."""
        return self.call_tool(tool_name, payload)

    @staticmethod
    def register(
        base_url: str = "https://archtools.dev",
        name: Optional[str] = None,
        email: Optional[str] = None,
        timeout: int = 20,
    ) -> Dict[str, Any]:
        """Register a new agent account (no API key required)."""
        base_url = base_url.rstrip("/")
        r = requests.post(
            f"{base_url}/v1/agent/register",
            json={"name": name, "email": email},
            timeout=timeout,
        )
        if not r.ok:
            raise ArchToolsError(f"Registration failed: HTTP {r.status_code}", status_code=r.status_code)
        return r.json()
