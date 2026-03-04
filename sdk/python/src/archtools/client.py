import os
import time
import requests
from typing import Any, Dict, Optional

try:
    # urllib3 is bundled with requests
    from urllib3.util.retry import Retry
except Exception:  # pragma: no cover
    Retry = None  # type: ignore


class ArchTools:
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

        # Requests session with safe defaults + optional retries
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
            adapter = requests.adapters.HTTPAdapter(max_retries=retry)
            self.session.mount("https://", adapter)
            self.session.mount("http://", adapter)

    def _headers(self) -> Dict[str, str]:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

    def _request(self, method: str, path: str, json_body: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        url = f"{self.base_url}{path}"
        r = self.session.request(
            method=method,
            url=url,
            json=json_body,
            headers=self._headers() if self.api_key else {"Content-Type": "application/json"},
            timeout=self.timeout,
        )

        # If we still got rate limited, do one manual Retry-After wait (best-effort)
        if r.status_code == 429:
            ra = r.headers.get("Retry-After")
            if ra:
                try:
                    time.sleep(min(10, float(ra)))
                except Exception:
                    pass

        r.raise_for_status()
        return r.json()

    def tools_list(self) -> Dict[str, Any]:
        return self._request("GET", "/v1/tools")

    def agent_usage(self) -> Dict[str, Any]:
        return self._request("GET", "/v1/agent/usage")

    def invoke(self, tool_name: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        return self._request("POST", f"/v1/tools/{tool_name}", payload)

    @staticmethod
    def register(
        base_url: str,
        name: Optional[str] = None,
        email: Optional[str] = None,
        timeout: int = 20,
    ) -> Dict[str, Any]:
        base_url = base_url.rstrip("/")
        r = requests.post(
            f"{base_url}/v1/agent/register",
            json={"name": name, "email": email},
            timeout=timeout,
        )
        r.raise_for_status()
        return r.json()
