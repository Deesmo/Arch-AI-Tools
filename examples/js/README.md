# Arch Tools — JavaScript Example

## Install
```bash
npm install node-fetch
```

## Register & Get API Key
```js
const r = await fetch("https://archtools.dev/v1/agent/register", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ name: "my-agent", email: "dev@example.com" })
});
const { api_key } = await r.json();
console.log("Save this key:", api_key);
```

## Call a Tool
```js
import fetch from "node-fetch";

const BASE = process.env.ARCH_API_BASE_URL || "https://archtools.dev";
const KEY = process.env.ARCH_API_KEY;

const r = await fetch(`${BASE}/v1/tools/generate-hash`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${KEY}`
  },
  body: JSON.stringify({ algorithm: "sha256", input: "hello world" })
});

console.log(await r.json());
```

## Check Credits
```js
const usage = await fetch(`${BASE}/v1/agent/usage`, {
  headers: { "Authorization": `Bearer ${KEY}` }
});
console.log(await usage.json());
```

## Buy Credits (Stripe Checkout)
```js
const checkout = await fetch(`${BASE}/v1/checkout`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${KEY}`
  },
  body: JSON.stringify({
    price_id: "price_1T6boqKzBSl1smzF8iMstc4o"  // Starter $9 / 1,000 credits
  })
});
const { checkout_url } = await checkout.json();
console.log("Complete purchase:", checkout_url);
```
