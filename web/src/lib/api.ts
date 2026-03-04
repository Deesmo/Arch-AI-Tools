export const API_BASE = process.env.NEXT_PUBLIC_API_BASE || (typeof window !== 'undefined' ? window.location.origin : 'https://archtools.dev')

export async function apiFetch(path: string, opts: RequestInit & { apiKey?: string } = {}) {
  const headers = new Headers(opts.headers || {})
  headers.set('Content-Type', 'application/json')
  if (opts.apiKey) headers.set('Authorization', `Bearer ${opts.apiKey}`)

  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers,
    cache: 'no-store'
  })

  const text = await res.text()
  let json: any = null
  try { json = JSON.parse(text) } catch { json = { raw: text } }

  if (!res.ok) {
    const err = new Error(json?.error || 'request_failed') as any
    err.status = res.status
    err.data = json
    throw err
  }

  return json
}
