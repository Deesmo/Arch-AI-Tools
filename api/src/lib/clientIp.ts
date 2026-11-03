import net from "node:net";
import type { Request, Response, NextFunction } from "express";

/**
 * The visitor's real IP.
 *
 * Traffic reaches us as visitor → Cloudflare → Render → app. With
 * `trust proxy` = 1, Express's req.ip is the hop Render saw — a Cloudflare edge
 * server (prod logs, 2026-11-03: 172.71.146.207 for a request from a home IP).
 * Every rate limit and every per-IP signup check was therefore counting
 * Cloudflare servers, not people.
 *
 * Cloudflare puts the visitor's address in CF-Connecting-IP and overwrites any
 * value a client sends. We trust that header only when the hop really is a
 * Cloudflare address, so a request sent straight to *.onrender.com can't fake it.
 * Ranges: https://www.cloudflare.com/ips-v4/ and https://www.cloudflare.com/ips-v6/
 * (fetched 2026-11-03; header docs:
 * https://developers.cloudflare.com/fundamentals/reference/http-headers/#cf-connecting-ip).
 */
const CLOUDFLARE_V4 = [
  "173.245.48.0/20", "103.21.244.0/22", "103.22.200.0/22", "103.31.4.0/22",
  "141.101.64.0/18", "108.162.192.0/18", "190.93.240.0/20", "188.114.96.0/20",
  "197.234.240.0/22", "198.41.128.0/17", "162.158.0.0/15", "104.16.0.0/13",
  "104.24.0.0/14", "172.64.0.0/13", "131.0.72.0/22",
];
const CLOUDFLARE_V6 = [
  "2400:cb00::/32", "2606:4700::/32", "2803:f800::/32", "2405:b500::/32",
  "2405:8100::/32", "2a06:98c0::/29", "2c0f:f248::/32",
];

const cloudflare = new net.BlockList();
for (const c of CLOUDFLARE_V4) { const [a, n] = c.split("/"); cloudflare.addSubnet(a, Number(n), "ipv4"); }
for (const c of CLOUDFLARE_V6) { const [a, n] = c.split("/"); cloudflare.addSubnet(a, Number(n), "ipv6"); }

function bare(ip: string): string {
  return ip.startsWith("::ffff:") && net.isIPv4(ip.slice(7)) ? ip.slice(7) : ip;
}

export function isCloudflareIp(ip: string | undefined): boolean {
  if (!ip) return false;
  const v = bare(ip.trim());
  const kind = net.isIP(v);
  return kind === 4 ? cloudflare.check(v, "ipv4") : kind === 6 ? cloudflare.check(v, "ipv6") : false;
}

// Our Cloudflare zone's hostnames. A request whose Host is one of these and
// whose hop is a Cloudflare address came through our zone, where Cloudflare
// overwrites CF-Connecting-IP. Something else on Cloudflare (a Worker, another
// zone) calling the Render origin directly uses the *.onrender.com host, so its
// CF-Connecting-IP is not trusted. Full origin lock (Authenticated Origin Pulls)
// is a Cloudflare-side setting.
const ZONE_HOSTS = new Set(["archtools.dev", "www.archtools.dev"]);

export function realClientIp(hop: string | undefined, cfConnectingIp: string | undefined, host?: string): string | undefined {
  const viaOurZone = host === undefined || ZONE_HOSTS.has(host.toLowerCase().replace(/:\d+$/, ""));
  if (hop && viaOurZone && isCloudflareIp(hop)) {
    const visitor = cfConnectingIp?.trim();
    if (visitor && net.isIP(visitor)) return bare(visitor);
  }
  return hop ? bare(hop) : hop;
}

/** Mount right after `trust proxy`: every later req.ip (rate limits, signup checks, logs) is the visitor. */
export function useRealClientIp(req: Request, _res: Response, next: NextFunction): void {
  const ip = realClientIp(req.ip, req.get("cf-connecting-ip"), req.get("host") ?? "");
  if (ip && ip !== req.ip) Object.defineProperty(req, "ip", { value: ip, configurable: true, enumerable: true });
  next();
}
