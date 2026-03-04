# Arch Tools — Python Example

## Install
```bash
pip install requests
```

## Register & Get API Key
```python
import requests

resp = requests.post(
    "https://archtools.dev/v1/agent/register",
    json={"name": "my-agent", "email": "dev@example.com"}
)
data = resp.json()
print("Save this key:", data["api_key"])
```

## Call a Tool
```python
import os, requests

BASE = os.environ.get("ARCH_API_BASE_URL", "https://archtools.dev")
KEY = os.environ["ARCH_API_KEY"]

resp = requests.post(
    f"{BASE}/v1/tools/transform-text",
    headers={"Authorization": f"Bearer {KEY}"},
    json={"mode": "uppercase", "text": "hello world"}
)

print(resp.json())
```

## Check Credits
```python
resp = requests.get(
    f"{BASE}/v1/agent/usage",
    headers={"Authorization": f"Bearer {KEY}"}
)
print(resp.json())
```

## Buy Credits (Stripe Checkout)
```python
resp = requests.post(
    f"{BASE}/v1/checkout",
    headers={"Authorization": f"Bearer {KEY}"},
    json={"price_id": "price_1T6boqKzBSl1smzF8iMstc4o"}  # Starter $9
)
print("Complete purchase:", resp.json()["checkout_url"])
```
