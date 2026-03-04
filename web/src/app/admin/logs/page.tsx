'use client';

import { useEffect, useMemo, useState } from 'react';
import { API_BASE } from '@/lib/api';

type LogRow = {
  id: string;
  createdAt: string;
  agentId?: string | null;
  apiKeyId?: string | null;
  apiKeyPrefix?: string | null;
  toolName?: string | null;
  endpoint?: string | null;
  method?: string | null;
  status?: number | null;
  latencyMs?: number | null;
  creditsUsed?: number | null;
  creditsRemaining?: number | null;
  requestId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
};

type BillingRow = {
  key: string;
  requests: number;
  error_count: number;
  error_rate: number;
  credits_used: number;
  avg_latency_ms: number;
};

type AdminKeyRow = { id: string; name: string; keyPrefix: string; scopes: string[]; isActive: boolean; lastUsedAt?: string | null; createdAt: string; updatedAt?: string };

type AdminInfo = { name: string; mode: string; scopes: string[]; keyPrefix?: string };

type FraudSignals = {
  traffic_spike?: { last_hour_requests: number; prev_hour_requests: number; ratio: number | null; note?: string };
  failing_tools?: { tool: string; error_count: number }[];
  noisy_ips?: { ip: string | null; error_count: number }[];
  offenders_429?: { agentId: string | null; count: number }[];
  offenders_auth?: { apiKeyPrefix: string | null; count: number }[];
  high_error_agents?: { agentId: string | null; requests: number; error_count: number; error_rate: number }[];
};

type PartitionInfo = { name: string; from: string | null; to: string | null };
type SystemJobRun = {
  jobName: string;
  lastRunAt?: string | null;
  lastStatus?: string | null;
  lastMessage?: string | null;
  lastDurationMs?: number | null;
  updatedAt?: string;
};

type SystemStatus = {
  ok: boolean;
  partitioning?: { enabled: boolean; partitioned: boolean };
  counts?: { api_request_logs: number; daily_rollups: number };
  jobs?: SystemJobRun[];
};

function pill(active: boolean) {
  return active
    ? 'rounded-xl bg-black text-white px-3 py-2 text-sm'
    : 'rounded-xl border px-3 py-2 text-sm hover:bg-neutral-50';
}

function fmtDt(x?: string | null) {
  if (!x) return '—';
  try {
    return new Date(x).toLocaleString();
  } catch {
    return String(x);
  }
}

export default function AdminLogsPage() {
  const [tab, setTab] = useState<'ops' | 'logs' | 'billing' | 'fraud'>('ops');

  const [adminKey, setAdminKey] = useState('');

  // Shared state
  const [error, setError] = useState<string | null>(null);

  // System / partitioning
  const [system, setSystem] = useState<SystemStatus | null>(null);
  const [partitions, setPartitions] = useState<PartitionInfo[]>([]);
  const [partitionsMeta, setPartitionsMeta] = useState<{ enabled: boolean; partitioned: boolean } | null>(null);
  const [opsLoading, setOpsLoading] = useState(false);

  // Logs
  const [toolName, setToolName] = useState('');
  const [status, setStatus] = useState('');
  const [agentId, setAgentId] = useState('');
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Billing
  const [billingDays, setBillingDays] = useState('7');
  const [billingGroupBy, setBillingGroupBy] = useState<'agent' | 'apiKey' | 'tool'>('agent');
  const [billingRows, setBillingRows] = useState<BillingRow[]>([]);
  const [billingLoading, setBillingLoading] = useState(false);

  // Rollup + partitions buttons
  const [rollupRunning, setRollupRunning] = useState(false);
  const [rollupDaysBack, setRollupDaysBack] = useState('3');
  const [rollupMsg, setRollupMsg] = useState<string | null>(null);

  const [partitionsRunning, setPartitionsRunning] = useState(false);
  const [partitionsResult, setPartitionsResult] = useState<any>(null);

  // Fraud
  const [fraudHours, setFraudHours] = useState('24');
  const [fraud, setFraud] = useState<FraudSignals | null>(null);
  const [fraudLoading, setFraudLoading] = useState(false);

  const canFetch = useMemo(() => Boolean(adminKey), [adminKey]);

  async function apiFetch(path: string, init?: RequestInit) {
    const headers: any = { ...(init?.headers || {}), 'x-admin-key': adminKey };
    const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(json?.message || json?.error || `Request failed (${res.status})`);
    }
    return json;
  }

  async function fetchSystemStatus() {
    if (!adminKey) return;
    setOpsLoading(true);
    setError(null);
    try {
      const st = await apiFetch('/v1/admin/system/status');
      setSystem(st);
    } catch (e: any) {
      setError(e?.message || String(e));
      setSystem(null);
    } finally {
      setOpsLoading(false);
    }
  }

  async function fetchPartitionsStatus() {
    if (!adminKey) return;
    setError(null);
    try {
      const ps = await apiFetch('/v1/admin/partitions/status');
      setPartitionsMeta({ enabled: Boolean(ps.enabled), partitioned: Boolean(ps.partitioned) });
      const list = (ps.partitions || []) as PartitionInfo[];
      setPartitions(list);
    } catch (e: any) {
      setError(e?.message || String(e));
      setPartitionsMeta(null);
      setPartitions([]);
    }
  }

  
  async function fetchWhoAmI(key?: string) {
    const k = (key ?? adminKey).trim();
    if (!k) { setAdminInfo(null); return; }
    try {
      setAdminErr(null);
      const res = await fetch(`${API_BASE}/v1/admin/whoami`, {
        headers: { 'x-admin-key': k },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAdminInfo(null);
        setAdminErr(data?.error || 'unauthorized');
        return;
      }
      setAdminInfo(data?.admin || null);
    } catch (e: any) {
      setAdminInfo(null);
      setAdminErr(e?.message || String(e));
    }
  }


  async function fetchKeys() {
    if (!adminKey) return;
    try {
      setKeysLoading(true);
      const res = await fetch(`${API_BASE}/v1/admin/keys`, { headers: { 'x-admin-key': adminKey } });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'failed');
      setAdminKeys(Array.isArray(data.keys) ? data.keys : []);
    } catch (e: any) {
      // ignore
    } finally {
      setKeysLoading(false);
    }
  }

  async function createKey() {
    if (!adminKey) return;
    setNewKeyResult(null);
    const scopes = newKeyScopes.split(',').map(s => s.trim()).filter(Boolean);
    try {
      setKeysLoading(true);
      const res = await fetch(`${API_BASE}/v1/admin/keys`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-key': adminKey },
        body: JSON.stringify({ name: newKeyName || 'admin', scopes }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'failed');
      const plaintext = data?.key?.plaintext;
      if (plaintext) setNewKeyResult(plaintext);
      fetchKeys();
    } catch (e: any) {
      setNewKeyResult(`Error: ${e?.message || String(e)}`);
    } finally {
      setKeysLoading(false);
    }
  }

  async function revokeKey(id: string) {
    if (!adminKey) return;
    try {
      setKeysLoading(true);
      const res = await fetch(`${API_BASE}/v1/admin/keys/${id}/revoke`, {
        method: 'POST',
        headers: { 'x-admin-key': adminKey },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'failed');
      fetchKeys();
    } catch {
      // ignore
    } finally {
      setKeysLoading(false);
    }
  }

async function fetchLogs(reset = true) {
    if (!adminKey) return;
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      if (toolName) qs.set('toolName', toolName);
      if (status) qs.set('status', status);
      if (agentId) qs.set('agentId', agentId);
      if (!reset && cursor) qs.set('cursor', cursor);
      const out = await apiFetch(`/v1/admin/request-logs?${qs.toString()}`);
      const newLogs = out.logs as LogRow[];
      const next = out.next_cursor as string | null;
      setCursor(next);
      setLogs((prev) => (reset ? newLogs : [...prev, ...newLogs]));
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  async function fetchBilling() {
    if (!adminKey) return;
    setBillingLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ days: billingDays, groupBy: billingGroupBy });
      const out = await apiFetch(`/v1/admin/billing-report?${qs.toString()}`);
      setBillingRows(out.rows || []);
    } catch (e: any) {
      setError(e?.message || String(e));
      setBillingRows([]);
    } finally {
      setBillingLoading(false);
    }
  }

  function downloadBillingCsv() {
    if (!adminKey) return;
    const qs = new URLSearchParams({ days: billingDays, groupBy: billingGroupBy });
    const url = `${API_BASE}/v1/admin/billing-report.csv?${qs.toString()}`;
    // Use fetch so we can attach admin key, then download blob
    (async () => {
      setError(null);
      try {
        const res = await fetch(url, { headers: { 'x-admin-key': adminKey } });
        if (!res.ok) throw new Error(`CSV export failed (${res.status})`);
        const blob = await res.blob();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `billing-report-${billingDays}d-${billingGroupBy}.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
      } catch (e: any) {
        setError(e?.message || String(e));
      }
    })();
  }

  async function fetchFraud() {
    if (!adminKey) return;
    setFraudLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ hours: fraudHours });
      const out = await apiFetch(`/v1/admin/fraud-signals?${qs.toString()}`);
      setFraud(out);
    } catch (e: any) {
      setError(e?.message || String(e));
      setFraud(null);
    } finally {
      setFraudLoading(false);
    }
  }

  async function runRollupNow() {
    if (!adminKey) return;
    setRollupRunning(true);
    setRollupMsg(null);
    setError(null);
    try {
      const out = await apiFetch('/v1/admin/rollup/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ daysBack: Number(rollupDaysBack) }),
      });
      setRollupMsg(`Rollup ok: daysBack=${out.daysBack}. Rolled ${out.rolled_up?.length || 0} day(s).`);
      await fetchSystemStatus();
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setRollupRunning(false);
    }
  }

  async function ensurePartitions() {
    if (!adminKey) return;
    setPartitionsRunning(true);
    setPartitionsResult(null);
    setError(null);
    try {
      const out = await apiFetch('/v1/admin/partitions/ensure', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ monthsAhead: 2 }),
      });
      setPartitionsResult(out);
      await fetchPartitionsStatus();
      await fetchSystemStatus();
    } catch (e: any) {
      setError(e?.message || String(e));
      setPartitionsResult({ ok: false, error: e?.message || String(e) });
    } finally {
      setPartitionsRunning(false);
    }
  }

  useEffect(() => {
    // convenience: persist admin key for this browser
    const saved = typeof window !== 'undefined' ? window.localStorage.getItem('arch_admin_key') : null;
    if (saved) setAdminKey(saved);
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined' && adminKey) window.localStorage.setItem('arch_admin_key', adminKey);
  }, [adminKey]);

  useEffect(() => {
    if (!adminKey) return;
    // Preload ops info when key appears
    fetchSystemStatus();
    fetchPartitionsStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminKey]);

  const partitionBanner = useMemo(() => {
    if (!partitionsMeta) return null;
    const { enabled, partitioned } = partitionsMeta;
    if (!enabled) {
      return { tone: 'neutral', text: 'Partitioning is OFF. Retention runs via row deletes (fine at low volume).' };
    }
    if (enabled && !partitioned) {
      return { tone: 'warn', text: 'Partitioning env is ON, but ApiRequestLog is NOT partitioned yet. Run the provided SQL conversion to enable DROP PARTITION retention.' };
    }
    return { tone: 'ok', text: 'Partitioning is ACTIVE. Retention uses DROP PARTITION (fast) when applicable.' };
  }, [partitionsMeta]);

  function bannerClass(tone: string) {
    if (tone === 'ok') return 'border-emerald-200 bg-emerald-50 text-emerald-800';
    if (tone === 'warn') return 'border-amber-200 bg-amber-50 text-amber-900';
    return 'border-neutral-200 bg-neutral-50 text-neutral-700';
  }

  
  useEffect(() => {
    if (tab === 'access' && adminKey && (canAdminRead || canAdminWrite)) {
      fetchKeys();
    }
  }, [tab, adminKey, canAdminRead, canAdminWrite]);
return (
    <div className="max-w-6xl mx-auto px-4 py-10">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-2xl font-semibold">Admin</div>
          <div className="text-sm text-neutral-500 mt-1">Logs, billing, fraud signals, and ops status.</div>
        </div>
        <div className="flex items-center gap-2">
          <button className={pill(tab === 'ops')} onClick={() => setTab('ops')}>Ops</button>
          <button className={pill(tab === 'logs')} onClick={() => setTab('logs')}>Logs</button>
          <button className={pill(tab === 'billing')} onClick={() => setTab('billing')}>Billing</button>
          <button className={pill(tab === 'fraud')} onClick={() => setTab('fraud')}>Fraud</button>
          <button className={pill(tab === 'access')} onClick={() => setTab('access')}>Access</button>
        </div>
      </div>

      <div className="mt-6 rounded-2xl border bg-white shadow-sm p-5">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
          <div className="md:col-span-2">
            <label className="text-xs text-neutral-500">Admin key</label>
            <input
              value={adminKey}
              onChange={(e) => setAdminKey(e.target.value)}
              placeholder="Paste ADMIN_API_KEY (or METRICS_API_KEY fallback)…"
              className="mt-1 w-full rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-neutral-200"
            />
            {adminInfo && (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                <span className="rounded-full border px-2 py-1">Signed in: <span className="font-medium">{adminInfo.name}</span></span>
                <span className="rounded-full border px-2 py-1">Mode: <span className="font-medium">{adminInfo.mode}</span></span>
                <span className="rounded-full border px-2 py-1">Scopes: <span className="font-medium">{adminInfo.scopes.join(', ')}</span></span>
                {!hasScope('ops:write') && (
                  <span className="rounded-full border bg-neutral-50 px-2 py-1">Read-only</span>
                )}
              </div>
            )}
            {adminErr && (
              <div className="mt-2 text-xs text-red-600">Auth error: {adminErr}</div>
            )}

          </div>
          <div className="flex gap-2">
            <button
              onClick={() => { fetchSystemStatus(); fetchPartitionsStatus(); }}
              disabled={!adminKey || opsLoading}
              className="w-full rounded-xl border px-4 py-2 text-sm disabled:opacity-50"
            >
              {opsLoading ? 'Refreshing…' : 'Refresh status'}
            </button>
          </div>
        </div>

        {partitionBanner && (
          <div className={`mt-4 rounded-xl border px-3 py-2 text-sm ${bannerClass(partitionBanner.tone)}`}>
            {partitionBanner.text}
          </div>
        )}

        {error && (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}
      </div>

      {tab === 'ops' && (
        <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="rounded-2xl border bg-white shadow-sm p-5">
            <div className="text-sm font-medium">System status</div>
            <div className="mt-3 text-sm space-y-1">
              <div>API request logs: <span className="font-medium">{system?.counts?.api_request_logs ?? '—'}</span></div>
              <div>Daily rollups: <span className="font-medium">{system?.counts?.daily_rollups ?? '—'}</span></div>
              <div>Partitioning enabled: <span className="font-medium">{String(system?.partitioning?.enabled ?? '—')}</span></div>
              <div>ApiRequestLog partitioned: <span className="font-medium">{String(system?.partitioning?.partitioned ?? '—')}</span></div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                onClick={runRollupNow}
                disabled={!canFetch || !canOps || rollupRunning}
                className="rounded-xl border px-4 py-2 text-sm disabled:opacity-50"
              >
                {rollupRunning ? 'Running…' : 'Run rollup now'}
              </button>
              <button
                onClick={ensurePartitions}
                disabled={!canFetch || !canOps || partitionsRunning}
                className="rounded-xl border px-4 py-2 text-sm disabled:opacity-50"
              >
                {partitionsRunning ? 'Working…' : 'Ensure partitions'}
              </button>
            </div>

            {rollupMsg && (
              <div className="mt-3 rounded-xl border bg-neutral-50 px-3 py-2 text-sm text-neutral-700">
                {rollupMsg}
              </div>
            )}

            {partitionsResult ? (
              <pre className="mt-3 max-h-56 overflow-auto rounded-xl bg-neutral-950 p-3 text-xs text-neutral-100">{JSON.stringify(partitionsResult, null, 2)}</pre>
            ) : null}
          </div>

          <div className="rounded-2xl border bg-white shadow-sm p-5">
            <div className="text-sm font-medium">Last job runs</div>
            <div className="text-xs text-neutral-500 mt-1">Cron + admin-triggered jobs write here.</div>

            <div className="mt-3 space-y-2">
              {(system?.jobs || []).map((j) => (
                <div key={j.jobName} className="rounded-xl border px-3 py-2">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-medium">{j.jobName}</div>
                    <div className={`text-xs px-2 py-1 rounded-full ${j.lastStatus === 'ok' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : j.lastStatus === 'error' ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-neutral-50 text-neutral-700 border border-neutral-200'}`}>
                      {j.lastStatus || 'unknown'}
                    </div>
                  </div>
                  <div className="mt-1 text-xs text-neutral-500">
                    Last run: {fmtDt(j.lastRunAt)}{j.lastDurationMs != null ? ` • ${j.lastDurationMs}ms` : ''}
                  </div>
                  {j.lastMessage ? <div className="mt-1 text-xs text-neutral-700">{j.lastMessage}</div> : null}
                </div>
              ))}
              {!system?.jobs?.length && <div className="text-sm text-neutral-500">No job history yet.</div>}
            </div>
          </div>

          <div className="lg:col-span-2 rounded-2xl border bg-white shadow-sm p-5">
            <div className="text-sm font-medium">Partitions</div>
            <div className="text-xs text-neutral-500 mt-1">Showing the most recent partitions (capped).</div>

            <div className="mt-3 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-neutral-50 text-neutral-600">
                  <tr>
                    <th className="text-left font-medium px-4 py-3">Table</th>
                    <th className="text-left font-medium px-4 py-3">From</th>
                    <th className="text-left font-medium px-4 py-3">To</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {partitions.map((p) => (
                    <tr key={p.name} className="hover:bg-neutral-50">
                      <td className="px-4 py-3 whitespace-nowrap">{p.name}</td>
                      <td className="px-4 py-3 whitespace-nowrap">{p.from ? fmtDt(p.from) : '—'}</td>
                      <td className="px-4 py-3 whitespace-nowrap">{p.to ? fmtDt(p.to) : '—'}</td>
                    </tr>
                  ))}
                  {!partitions.length && (
                    <tr>
                      <td className="px-4 py-6 text-neutral-500" colSpan={3}>
                        No partitions found (either not enabled, or ApiRequestLog not converted yet).
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="mt-3 text-xs text-neutral-500">
              If you want partitioning: set <code className="px-1 rounded bg-neutral-100">ENABLE_PARTITIONING=true</code> and run the SQL conversion in <code className="px-1 rounded bg-neutral-100">api/prisma/partitioning/postgres_partitioning.sql</code>.
            </div>
          </div>
        </div>
      )}

      {tab === 'logs' && (
        <div className="mt-6">
          <div className="rounded-2xl border bg-white shadow-sm p-5">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div>
                <label className="text-xs text-neutral-500">Tool</label>
                <input
                  value={toolName}
                  onChange={(e) => setToolName(e.target.value)}
                  placeholder="web-scrape"
                  className="mt-1 w-full rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-neutral-200"
                />
              </div>
              <div>
                <label className="text-xs text-neutral-500">Status</label>
                <input
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  placeholder="200"
                  className="mt-1 w-full rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-neutral-200"
                />
              </div>
              <div className="md:col-span-2">
                <label className="text-xs text-neutral-500">Agent ID</label>
                <input
                  value={agentId}
                  onChange={(e) => setAgentId(e.target.value)}
                  placeholder="cuid…"
                  className="mt-1 w-full rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-neutral-200"
                />
              </div>
              <div className="md:col-span-4 flex items-end gap-2">
                <button
                  onClick={() => { setCursor(null); fetchLogs(true); }}
                  disabled={!canFetch || loading}
                  className="rounded-xl bg-black text-white px-4 py-2 text-sm disabled:opacity-50"
                >
                  {loading ? 'Loading…' : 'Fetch logs'}
                </button>
                <button
                  onClick={() => { setLogs([]); setCursor(null); setToolName(''); setStatus(''); setAgentId(''); }}
                  className="rounded-xl border px-4 py-2 text-sm"
                >
                  Clear
                </button>
              </div>
            </div>
          </div>

          <div className="mt-4 rounded-2xl border bg-white shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-neutral-50 text-neutral-600">
                  <tr>
                    <th className="text-left font-medium px-4 py-3">Time</th>
                    <th className="text-left font-medium px-4 py-3">Tool</th>
                    <th className="text-left font-medium px-4 py-3">Status</th>
                    <th className="text-left font-medium px-4 py-3">Credits</th>
                    <th className="text-left font-medium px-4 py-3">Latency</th>
                    <th className="text-left font-medium px-4 py-3">Request</th>
                    <th className="text-left font-medium px-4 py-3">Key</th>
                    <th className="text-left font-medium px-4 py-3">Error</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {logs.map((l) => (
                    <tr key={l.id} className="hover:bg-neutral-50">
                      <td className="px-4 py-3 whitespace-nowrap">{new Date(l.createdAt).toLocaleString()}</td>
                      <td className="px-4 py-3 whitespace-nowrap">{l.toolName || '-'}</td>
                      <td className="px-4 py-3 whitespace-nowrap">{l.status ?? '-'}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className="text-neutral-700">{l.creditsUsed ?? '-'}</span>
                        <span className="text-neutral-400"> / </span>
                        <span className="text-neutral-500">{l.creditsRemaining ?? '-'}</span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">{l.latencyMs != null ? `${l.latencyMs}ms` : '-'}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="text-neutral-800">{l.requestId || '-'}</div>
                        <div className="text-xs text-neutral-500 truncate max-w-[260px]">{l.endpoint || ''}</div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="text-neutral-800">{l.apiKeyPrefix || '-'}</div>
                        <div className="text-xs text-neutral-500 truncate max-w-[220px]">{l.agentId || ''}</div>
                      </td>
                      <td className="px-4 py-3">
                        {l.errorCode ? (
                          <div>
                            <div className="text-red-700">{l.errorCode}</div>
                            <div className="text-xs text-red-600 truncate max-w-[320px]">{l.errorMessage || ''}</div>
                          </div>
                        ) : (
                          <span className="text-neutral-400">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {!logs.length && (
                    <tr>
                      <td className="px-4 py-6 text-neutral-500" colSpan={8}>
                        No logs yet. Add your admin key and click “Fetch logs”.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between px-4 py-3 border-t bg-white">
              <div className="text-xs text-neutral-500">
                Showing {logs.length} {logs.length === 1 ? 'row' : 'rows'}{cursor ? ' (more available)' : ''}.
              </div>
              <button
                onClick={() => fetchLogs(false)}
                disabled={!cursor || loading || !canFetch}
                className="rounded-xl border px-4 py-2 text-sm disabled:opacity-50"
              >
                Load more
              </button>
            </div>
          </div>
        </div>
      )}

      {tab === 'billing' && (
        <div className="mt-6">
          <div className="rounded-2xl border bg-white shadow-sm p-5">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div>
                <label className="text-xs text-neutral-500">Days</label>
                <select
                  value={billingDays}
                  onChange={(e) => setBillingDays(e.target.value)}
                  className="mt-1 w-full rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-neutral-200"
                >
                  <option value="1">1</option>
                  <option value="7">7</option>
                  <option value="30">30</option>
                  <option value="90">90</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-neutral-500">Group by</label>
                <select
                  value={billingGroupBy}
                  onChange={(e) => setBillingGroupBy(e.target.value as any)}
                  className="mt-1 w-full rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-neutral-200"
                >
                  <option value="agent">Agent</option>
                  <option value="apiKey">API key</option>
                  <option value="tool">Tool</option>
                </select>
              </div>
              <div className="md:col-span-2 flex items-end gap-2">
                <button
                  onClick={() => fetchBilling()}
                  disabled={!canFetch || billingLoading}
                  className="rounded-xl bg-black text-white px-4 py-2 text-sm disabled:opacity-50"
                >
                  {billingLoading ? 'Loading…' : 'Run report'}
                </button>
                <button
                  onClick={() => downloadBillingCsv()}
                  disabled={!canFetch}
                  className="rounded-xl border px-4 py-2 text-sm"
                >
                  Export CSV
                </button>
              </div>

              <div className="md:col-span-4 mt-4 pt-4 border-t">
                <div className="flex flex-wrap items-end gap-2">
                  <div>
                    <label className="text-xs text-neutral-500">Rollup days back</label>
                    <select
                      value={rollupDaysBack}
                      onChange={(e) => setRollupDaysBack(e.target.value)}
                      className="mt-1 w-40 rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-neutral-200"
                    >
                      <option value="1">1</option>
                      <option value="3">3</option>
                      <option value="7">7</option>
                      <option value="14">14</option>
                    </select>
                  </div>
                  <button
                    onClick={runRollupNow}
                    disabled={!canFetch || !canOps || rollupRunning}
                    className="rounded-xl border px-4 py-2 text-sm disabled:opacity-50"
                    title="Runs the daily rollup + retention immediately (admin-only)."
                  >
                    {rollupRunning ? 'Running…' : 'Run rollup now'}
                  </button>
                  <button
                    onClick={ensurePartitions}
                    disabled={!canFetch || !canOps || partitionsRunning}
                    className="rounded-xl border px-4 py-2 text-sm disabled:opacity-50"
                    title="Creates current + upcoming monthly partitions (if partitioning enabled) and drops old partitions for retention."
                  >
                    {partitionsRunning ? 'Working…' : 'Ensure partitions'}
                  </button>
                  <div className="text-xs text-neutral-500">
                    Tip: run rollup after deploy; ensure partitions if you enable partitioning.
                  </div>
                </div>

                {rollupMsg && (
                  <div className="mt-3 rounded-xl border bg-neutral-50 px-3 py-2 text-sm text-neutral-700">
                    {rollupMsg}
                  </div>
                )}

                {partitionsResult ? (
                  <pre className="mt-3 max-h-56 overflow-auto rounded-xl bg-neutral-950 p-3 text-xs text-neutral-100">{JSON.stringify(partitionsResult, null, 2)}</pre>
                ) : null}
              </div>
            </div>
          </div>

          <div className="mt-4 rounded-2xl border bg-white shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-neutral-50 text-neutral-600">
                  <tr>
                    <th className="text-left font-medium px-4 py-3">Group</th>
                    <th className="text-left font-medium px-4 py-3">Requests</th>
                    <th className="text-left font-medium px-4 py-3">Errors</th>
                    <th className="text-left font-medium px-4 py-3">Error rate</th>
                    <th className="text-left font-medium px-4 py-3">Credits used</th>
                    <th className="text-left font-medium px-4 py-3">Avg latency</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {billingRows.map((r) => (
                    <tr key={r.key} className="hover:bg-neutral-50">
                      <td className="px-4 py-3 whitespace-nowrap">{r.key}</td>
                      <td className="px-4 py-3 whitespace-nowrap">{r.requests}</td>
                      <td className="px-4 py-3 whitespace-nowrap">{r.error_count}</td>
                      <td className="px-4 py-3 whitespace-nowrap">{(r.error_rate * 100).toFixed(2)}%</td>
                      <td className="px-4 py-3 whitespace-nowrap">{r.credits_used}</td>
                      <td className="px-4 py-3 whitespace-nowrap">{r.avg_latency_ms}ms</td>
                    </tr>
                  ))}
                  {!billingRows.length && (
                    <tr>
                      <td className="px-4 py-6 text-neutral-500" colSpan={6}>
                        Run a report to see aggregated usage. Export CSV for spreadsheets.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {tab === 'fraud' && (
        <div className="mt-6">
          <div className="rounded-2xl border bg-white shadow-sm p-5">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
              <div>
                <label className="text-xs text-neutral-500">Hours</label>
                <select
                  value={fraudHours}
                  onChange={(e) => setFraudHours(e.target.value)}
                  className="mt-1 w-full rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-neutral-200"
                >
                  <option value="1">1</option>
                  <option value="6">6</option>
                  <option value="24">24</option>
                  <option value="168">168 (7d)</option>
                </select>
              </div>
              <div className="md:col-span-3 flex items-end gap-2">
                <button
                  onClick={() => fetchFraud()}
                  disabled={!canFetch || fraudLoading}
                  className="rounded-xl bg-black text-white px-4 py-2 text-sm disabled:opacity-50"
                >
                  {fraudLoading ? 'Loading…' : 'Refresh signals'}
                </button>
              </div>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="rounded-2xl border bg-white shadow-sm p-5">
              <div className="text-sm font-medium">Traffic spike</div>
              <div className="text-xs text-neutral-500 mt-1">{fraud?.traffic_spike?.note || 'Compare last hour vs previous hour.'}</div>
              <div className="mt-3 text-sm">
                <div>Last hour: <span className="font-medium">{fraud?.traffic_spike?.last_hour_requests ?? '-'}</span></div>
                <div>Prev hour: <span className="font-medium">{fraud?.traffic_spike?.prev_hour_requests ?? '-'}</span></div>
                <div>Ratio: <span className="font-medium">{fraud?.traffic_spike?.ratio ?? '-'}</span></div>
              </div>
            </div>

            <div className="rounded-2xl border bg-white shadow-sm p-5">
              <div className="text-sm font-medium">High error agents</div>
              <div className="text-xs text-neutral-500 mt-1">Min 25 reqs, ≥ 25% errors.</div>
              <div className="mt-3 space-y-2">
                {(fraud?.high_error_agents || []).map((x) => (
                  <div key={x.agentId || Math.random()} className="flex items-center justify-between text-sm">
                    <div className="truncate max-w-[70%]">{x.agentId}</div>
                    <div className="text-neutral-700">{(x.error_rate * 100).toFixed(1)}%</div>
                  </div>
                ))}
                {!fraud?.high_error_agents?.length && <div className="text-sm text-neutral-500">No high-error agents detected.</div>}
              </div>
            </div>

            <div className="rounded-2xl border bg-white shadow-sm p-5">
              <div className="text-sm font-medium">Failing tools</div>
              <div className="mt-3 space-y-2">
                {(fraud?.failing_tools || []).map((x) => (
                  <div key={x.tool} className="flex items-center justify-between text-sm">
                    <div>{x.tool}</div>
                    <div className="text-neutral-700">{x.error_count}</div>
                  </div>
                ))}
                {!fraud?.failing_tools?.length && <div className="text-sm text-neutral-500">No tool errors detected.</div>}
              </div>
            </div>

            <div className="rounded-2xl border bg-white shadow-sm p-5">
              <div className="text-sm font-medium">Noisy IPs</div>
              <div className="mt-3 space-y-2">
                {(fraud?.noisy_ips || []).map((x) => (
                  <div key={String(x.ip)} className="flex items-center justify-between text-sm">
                    <div className="truncate max-w-[70%]">{x.ip}</div>
                    <div className="text-neutral-700">{x.error_count}</div>
                  </div>
                ))}
                {!fraud?.noisy_ips?.length && <div className="text-sm text-neutral-500">No noisy IPs detected.</div>}
              </div>
            </div>

            <div className="rounded-2xl border bg-white shadow-sm p-5">
              <div className="text-sm font-medium">429 offenders</div>
              <div className="text-xs text-neutral-500 mt-1">Agents hitting rate limits.</div>
              <div className="mt-3 space-y-2">
                {(fraud?.offenders_429 || []).map((x) => (
                  <div key={String(x.agentId)} className="flex items-center justify-between text-sm">
                    <div className="truncate max-w-[70%]">{x.agentId}</div>
                    <div className="text-neutral-700">{x.count}</div>
                  </div>
                ))}
                {!fraud?.offenders_429?.length && <div className="text-sm text-neutral-500">No 429 offenders detected.</div>}
              </div>
            </div>

            <div className="rounded-2xl border bg-white shadow-sm p-5">
              <div className="text-sm font-medium">Auth offenders</div>
              <div className="text-xs text-neutral-500 mt-1">API key prefixes producing 401/403.</div>
              <div className="mt-3 space-y-2">
                {(fraud?.offenders_auth || []).map((x) => (
                  <div key={String(x.apiKeyPrefix)} className="flex items-center justify-between text-sm">
                    <div className="truncate max-w-[70%]">{x.apiKeyPrefix}</div>
                    <div className="text-neutral-700">{x.count}</div>
                  </div>
                ))}
                {!fraud?.offenders_auth?.length && <div className="text-sm text-neutral-500">No auth offenders detected.</div>}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
  function hasScope(scope: string) {
    return !!adminInfo?.scopes?.includes(scope);
  }
  const canOps = hasScope('ops:write');
  const canAdminRead = hasScope('admin:read');
  const canAdminWrite = hasScope('admin:write');

