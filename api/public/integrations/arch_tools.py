"""
Arch Tools Python SDK
=====================

A lightweight Python client for the Arch Tools API (archtools.dev).
Supports API key auth and x402 USDC payments for all 58+ tools.

Install dependencies:
    pip install httpx

Usage:
    from arch_tools import ArchToolsClient

    client = ArchToolsClient(api_key="arch_...")
    result = client.call_tool("summarize", text="Hello world...", style="bullets")
    print(result)

    # Async usage
    import asyncio
    async def main():
        async with ArchToolsAsyncClient(api_key="arch_...") as client:
            result = await client.call_tool("ai-generate", prompt="Explain x402")
            print(result)
    asyncio.run(main())
"""

from __future__ import annotations

import os
import time
import json
from typing import Any, Optional
from urllib.parse import urljoin, quote

try:
    import httpx
except ImportError:
    httpx = None  # type: ignore

# Fallback to stdlib if httpx not installed
import urllib.request
import urllib.error


# ─── Exceptions ───────────────────────────────────────────────────────────────

class ArchToolsError(Exception):
    """Base exception for Arch Tools SDK errors."""

    def __init__(self, message: str, status_code: int | None = None, response: dict | None = None):
        super().__init__(message)
        self.status_code = status_code
        self.response = response or {}


class ArchToolsRateLimitError(ArchToolsError):
    """Raised when rate limited (HTTP 429)."""

    def __init__(self, message: str, retry_after: float | None = None, **kwargs: Any):
        super().__init__(message, **kwargs)
        self.retry_after = retry_after


class ArchToolsPaymentRequiredError(ArchToolsError):
    """Raised when payment is required (HTTP 402). Contains x402 payment details."""

    def __init__(self, message: str, payment_details: dict | None = None, **kwargs: Any):
        super().__init__(message, **kwargs)
        self.payment_details = payment_details or {}


class ArchToolsAuthError(ArchToolsError):
    """Raised for authentication failures (HTTP 401/403)."""
    pass


# ─── Tool catalog (all 64 tools) ─────────────────────────────────────────────

TOOL_NAMES: list[str] = [
    "validate-data", "generate-hash", "qr-code", "convert-format",
    "transform-text", "extract-metadata", "web-scrape", "extract-page",
    "search-web", "rss-parse", "ip-lookup", "whois-lookup", "email-verify",
    "phone-validate", "currency-convert", "timezone-convert", "generate-uuid",
    "diff-text", "readability-score", "language-detect", "sentiment-analysis",
    "summarize", "extract-entities", "regex-generate", "pii-detect",
    "web-search", "ai-generate", "ocr-extract", "browser-task", "extract-pdf",
    "screenshot-capture", "html-to-markdown", "url-shorten", "webhook-send",
    "jsonpath-query", "image-generate", "barcode-generate", "workflow-agent",
    "crypto-price", "crypto-ohlcv", "crypto-market-cap", "crypto-fear-greed",
    "crypto-sentiment", "crypto-news", "token-lookup", "ai-oracle",
    "session-create", "session-message", "text-to-speech", "transcribe-audio",
    "email-send", "design-create", "domain-check", "news-search",
    "research-report", "fact-check", "video-generate", "image-remove-bg",
    "email-find", "semantic-search", "social-post",
]


# ─── Synchronous client (stdlib fallback + httpx) ────────────────────────────

class ArchToolsClient:
    """
    Synchronous Python client for Arch Tools API.

    Args:
        api_key: Your Arch Tools API key (starts with 'arch_').
        base_url: API base URL. Defaults to https://archtools.dev.
        timeout: Request timeout in seconds.
        max_retries: Number of retries for transient errors (429, 5xx).
    """

    def __init__(
        self,
        api_key: str | None = None,
        base_url: str | None = None,
        timeout: float = 30.0,
        max_retries: int = 2,
    ):
        self.api_key = api_key or os.environ.get("ARCHTOOLS_API_KEY", "")
        self.base_url = (base_url or os.environ.get("ARCHTOOLS_BASE_URL", "https://archtools.dev")).rstrip("/")
        self.timeout = timeout
        self.max_retries = max_retries

        # Use httpx if available for better connection pooling
        self._client: httpx.Client | None = None
        if httpx is not None:
            self._client = httpx.Client(
                base_url=self.base_url,
                timeout=self.timeout,
                headers=self._headers(),
            )

    def _headers(self) -> dict[str, str]:
        h: dict[str, str] = {"Content-Type": "application/json"}
        if self.api_key:
            h["Authorization"] = f"Bearer {self.api_key}"
        return h

    def _request(self, method: str, path: str, body: dict | None = None) -> dict:
        """Make an HTTP request with retry logic."""
        url = f"{self.base_url}{path}"

        for attempt in range(self.max_retries + 1):
            try:
                if self._client is not None:
                    resp = self._client.request(method, path, json=body)
                    status = resp.status_code
                    data = resp.json() if resp.content else {}
                    retry_after_header = resp.headers.get("retry-after")
                    payment_header = resp.headers.get("x-payment-details")
                else:
                    # stdlib fallback
                    req = urllib.request.Request(
                        url,
                        data=json.dumps(body).encode() if body else None,
                        headers=self._headers(),
                        method=method,
                    )
                    try:
                        with urllib.request.urlopen(req, timeout=self.timeout) as resp_raw:
                            status = resp_raw.status
                            data = json.loads(resp_raw.read().decode())
                            retry_after_header = resp_raw.headers.get("Retry-After")
                            payment_header = resp_raw.headers.get("X-Payment-Details")
                    except urllib.error.HTTPError as e:
                        status = e.code
                        data = json.loads(e.read().decode()) if e.fp else {}
                        retry_after_header = e.headers.get("Retry-After") if e.headers else None
                        payment_header = e.headers.get("X-Payment-Details") if e.headers else None

                # Success
                if 200 <= status < 300:
                    return data

                # 402 Payment Required — not retryable
                if status == 402:
                    details = {}
                    if payment_header:
                        try:
                            details = json.loads(payment_header)
                        except Exception:
                            details = {"raw": payment_header}
                    raise ArchToolsPaymentRequiredError(
                        f"Payment required: {data.get('error', 'x402 payment needed')}",
                        status_code=status,
                        response=data,
                        payment_details=details,
                    )

                # 401/403 — not retryable
                if status in (401, 403):
                    raise ArchToolsAuthError(
                        f"Auth error ({status}): {data.get('error', 'unauthorized')}",
                        status_code=status,
                        response=data,
                    )

                # 429 / 5xx — retryable
                if status == 429 or 500 <= status <= 504:
                    if attempt < self.max_retries:
                        wait = _parse_retry_after(retry_after_header) or min(5.0, 0.3 * (2 ** attempt))
                        time.sleep(wait)
                        continue
                    if status == 429:
                        raise ArchToolsRateLimitError(
                            f"Rate limited: {data.get('message', '')}",
                            status_code=status,
                            response=data,
                            retry_after=_parse_retry_after(retry_after_header),
                        )

                # Other errors
                raise ArchToolsError(
                    f"API error ({status}): {data.get('error', 'unknown')}",
                    status_code=status,
                    response=data,
                )

            except (ArchToolsError,):
                raise
            except Exception as e:
                if attempt < self.max_retries:
                    time.sleep(min(5.0, 0.3 * (2 ** attempt)))
                    continue
                raise ArchToolsError(f"Request failed: {e}") from e

        raise ArchToolsError("Max retries exceeded")

    # ─── Public API ───────────────────────────────────────────────────────

    def call_tool(self, tool_name: str, **params: Any) -> dict:
        """
        Call any Arch Tools tool by name.

        Args:
            tool_name: Tool name (e.g. 'summarize', 'ai-generate', 'web-scrape').
            **params: Tool-specific parameters.

        Returns:
            dict: Tool response.

        Example:
            result = client.call_tool("summarize", text="Long text...", style="bullets")
        """
        return self._request("POST", f"/v1/tools/{quote(tool_name, safe='')}", body=params)

    def list_tools(self) -> dict:
        """List all available tools."""
        return self._request("GET", "/v1/tools")

    def register(self, name: str | None = None, email: str | None = None) -> dict:
        """Register a new agent and get an API key."""
        body: dict[str, Any] = {}
        if name:
            body["name"] = name
        if email:
            body["email"] = email
        return self._request("POST", "/v1/agent/register", body=body)

    def usage(self) -> dict:
        """Get current agent usage stats."""
        return self._request("GET", "/v1/agent/usage")

    # ─── Convenience methods for popular tools ────────────────────────────

    def summarize(self, text: str, style: str = "bullets", max_length: int | None = None) -> dict:
        params: dict[str, Any] = {"text": text, "style": style}
        if max_length:
            params["max_length"] = max_length
        return self.call_tool("summarize", **params)

    def ai_generate(self, prompt: str, model: str = "claude", system: str | None = None) -> dict:
        params: dict[str, Any] = {"prompt": prompt, "model": model}
        if system:
            params["system"] = system
        return self.call_tool("ai-generate", **params)

    def web_scrape(self, url: str, format: str = "markdown") -> dict:
        return self.call_tool("web-scrape", url=url, format=format)

    def search_web(self, query: str, limit: int = 5) -> dict:
        return self.call_tool("web-search", query=query, limit=limit)

    def sentiment(self, text: str) -> dict:
        return self.call_tool("sentiment-analysis", text=text)

    def screenshot(self, url: str, full_page: bool = False) -> dict:
        return self.call_tool("screenshot-capture", url=url, full_page=full_page)

    def image_generate(self, prompt: str, size: str = "1024x1024") -> dict:
        return self.call_tool("image-generate", prompt=prompt, size=size)

    def close(self) -> None:
        if self._client is not None:
            self._client.close()

    def __enter__(self) -> "ArchToolsClient":
        return self

    def __exit__(self, *args: Any) -> None:
        self.close()


# ─── Async client (requires httpx) ───────────────────────────────────────────

class ArchToolsAsyncClient:
    """
    Async Python client for Arch Tools API. Requires httpx.

    Usage:
        async with ArchToolsAsyncClient(api_key="arch_...") as client:
            result = await client.call_tool("ai-generate", prompt="Hello")
    """

    def __init__(
        self,
        api_key: str | None = None,
        base_url: str | None = None,
        timeout: float = 30.0,
        max_retries: int = 2,
    ):
        if httpx is None:
            raise ImportError("httpx is required for async client: pip install httpx")

        self.api_key = api_key or os.environ.get("ARCHTOOLS_API_KEY", "")
        self.base_url = (base_url or os.environ.get("ARCHTOOLS_BASE_URL", "https://archtools.dev")).rstrip("/")
        self.timeout = timeout
        self.max_retries = max_retries
        self._client = httpx.AsyncClient(
            base_url=self.base_url,
            timeout=self.timeout,
            headers=self._headers(),
        )

    def _headers(self) -> dict[str, str]:
        h: dict[str, str] = {"Content-Type": "application/json"}
        if self.api_key:
            h["Authorization"] = f"Bearer {self.api_key}"
        return h

    async def _request(self, method: str, path: str, body: dict | None = None) -> dict:
        import asyncio

        for attempt in range(self.max_retries + 1):
            try:
                resp = await self._client.request(method, path, json=body)
                status = resp.status_code
                data = resp.json() if resp.content else {}
                retry_after_header = resp.headers.get("retry-after")
                payment_header = resp.headers.get("x-payment-details")

                if 200 <= status < 300:
                    return data

                if status == 402:
                    details = {}
                    if payment_header:
                        try:
                            details = json.loads(payment_header)
                        except Exception:
                            details = {"raw": payment_header}
                    raise ArchToolsPaymentRequiredError(
                        f"Payment required: {data.get('error', 'x402 payment needed')}",
                        status_code=status,
                        response=data,
                        payment_details=details,
                    )

                if status in (401, 403):
                    raise ArchToolsAuthError(
                        f"Auth error ({status}): {data.get('error', 'unauthorized')}",
                        status_code=status,
                        response=data,
                    )

                if status == 429 or 500 <= status <= 504:
                    if attempt < self.max_retries:
                        wait = _parse_retry_after(retry_after_header) or min(5.0, 0.3 * (2 ** attempt))
                        await asyncio.sleep(wait)
                        continue
                    if status == 429:
                        raise ArchToolsRateLimitError(
                            f"Rate limited: {data.get('message', '')}",
                            status_code=status,
                            response=data,
                            retry_after=_parse_retry_after(retry_after_header),
                        )

                raise ArchToolsError(
                    f"API error ({status}): {data.get('error', 'unknown')}",
                    status_code=status,
                    response=data,
                )

            except ArchToolsError:
                raise
            except Exception as e:
                if attempt < self.max_retries:
                    await asyncio.sleep(min(5.0, 0.3 * (2 ** attempt)))
                    continue
                raise ArchToolsError(f"Request failed: {e}") from e

        raise ArchToolsError("Max retries exceeded")

    async def call_tool(self, tool_name: str, **params: Any) -> dict:
        return await self._request("POST", f"/v1/tools/{quote(tool_name, safe='')}", body=params)

    async def list_tools(self) -> dict:
        return await self._request("GET", "/v1/tools")

    async def summarize(self, text: str, style: str = "bullets") -> dict:
        return await self.call_tool("summarize", text=text, style=style)

    async def ai_generate(self, prompt: str, model: str = "claude") -> dict:
        return await self.call_tool("ai-generate", prompt=prompt, model=model)

    async def web_scrape(self, url: str, format: str = "markdown") -> dict:
        return await self.call_tool("web-scrape", url=url, format=format)

    async def search_web(self, query: str, limit: int = 5) -> dict:
        return await self.call_tool("web-search", query=query, limit=limit)

    async def close(self) -> None:
        await self._client.aclose()

    async def __aenter__(self) -> "ArchToolsAsyncClient":
        return self

    async def __aexit__(self, *args: Any) -> None:
        await self.close()


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _parse_retry_after(header: str | None) -> float | None:
    if not header:
        return None
    try:
        val = float(header.strip())
        return min(10.0, max(0, val))
    except ValueError:
        pass
    return None
