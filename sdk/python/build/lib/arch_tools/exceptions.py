class ArchToolsError(Exception):
    def __init__(self, response_data=None):
        self.data = response_data or {}
        super().__init__(self.data.get("message", "Arch Tools API error"))

class RateLimitError(ArchToolsError):
    def __init__(self, response_data=None, headers=None):
        self.headers = headers or {}
        self.retry_after = headers.get("Retry-After") if headers else None
        super().__init__(response_data)

class PaymentRequiredError(ArchToolsError):
    """Raised when x402 payment is required (no credits, no x402 payment header)."""
    pass
