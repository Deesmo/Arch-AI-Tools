# archtools (Python SDK)

## Install (local)
```bash
pip install -e .
```

## Usage
```python
from archtools import ArchTools

client = ArchTools(api_key="arch_...", base_url="https://archtools.dev")
print(client.tools_list())
print(client.agent_usage())
print(client.invoke("web-scrape", {"url": "https://example.com"}))
```
