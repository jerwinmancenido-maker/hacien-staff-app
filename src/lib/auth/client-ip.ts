// Client IP for rate limits and the audit log.
//
// X-Forwarded-For is "client, proxy1, proxy2…": each proxy APPENDS the address it
// received the request from. Anything to the left of what our own proxies added
// was sent by the client and can be forged, so the first value is never trusted.
// With TRUSTED_PROXY_COUNT=N (default 1: the host's reverse proxy) the client is
// the Nth address from the right. With 0, forwarding headers are ignored.

export const DEFAULT_TRUSTED_PROXY_COUNT = 1;

export function trustedProxyCount(raw: string | undefined = process.env.TRUSTED_PROXY_COUNT): number {
  if (raw === undefined || raw.trim() === "") return DEFAULT_TRUSTED_PROXY_COUNT;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : DEFAULT_TRUSTED_PROXY_COUNT;
}

type HeaderBag = { get(name: string): string | null };

export function clientIp(headers: HeaderBag, trustedProxies: number = trustedProxyCount()): string {
  if (trustedProxies <= 0) return "unknown";
  const forwarded = (headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  // Fewer entries than proxies: every entry came from our side, so the leftmost is the client.
  // (X-Real-IP is not used: we can't tell whether our proxy or the client set it.)
  const ip = forwarded[Math.max(0, forwarded.length - trustedProxies)] ?? "unknown";
  return ip.slice(0, 64);
}
