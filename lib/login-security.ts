import { isIP } from 'node:net';
import { createHash } from 'node:crypto';

// Exact addresses only. IPv4-mapped IPv6 is normalized before matching.
export function address(value: string): string | null {
  const normalized = value.startsWith('::ffff:') && isIP(value.slice(7)) === 4 ? value.slice(7) : value;
  return isIP(normalized) ? normalized.toLowerCase() : null;
}
export function trustedProxies(value = ''): Set<string> {
  const result = new Set<string>();
  for (const part of value.split(',').map(value => value.trim()).filter(Boolean)) {
    const parsed = address(part);
    if (!parsed) throw Error('TRUSTED_PROXIES must contain exact IP addresses');
    result.add(parsed);
  }
  return result;
}
export function clientAddress(peer: string, forwarded: string | string[] | undefined, trusted: Set<string>): string {
  const direct = address(peer);
  if (!direct) return 'unknown';
  if (!trusted.has(direct) || forwarded === undefined) return direct;
  if (typeof forwarded !== 'string') return direct;
  const chain = forwarded.split(',').map(value => address(value.trim()));
  // Malformed / excessive chains fail closed to the actual connection address.
  if (chain.length > 16 || chain.some(value => value === null)) return direct;
  let current = direct;
  for (let i = chain.length - 1; i >= 0 && trusted.has(current); i--) current = chain[i]!;
  return current;
}

type Counter = { count: number; expires: number; blockedUntil: number };
export const loginLimits = { windowMs: 900_000, pair: 10, account: 40, source: 400, global: 2000, maxEntries: 10_000 } as const;
/** Process-local fixed windows, bounded memory, no attacker-controlled eviction of live counters. */
export function loginLimiter(now: () => number = Date.now) {
  const counters = new Map<string, Counter>();
  const keys = (source: string, login: unknown) => {
    const account = createHash('sha256').update(typeof login === 'string' ? login.slice(0, 128) : '').digest('hex');
    return [`p:${source}:${account}`, `a:${account}`, `s:${source}`, 'global'];
  };
  const cleanup = () => { const time = now(); for (const [key, value] of counters) if (value.expires <= time) counters.delete(key); };
  function check(source: string, login: unknown) {
    cleanup();
    const selected = keys(source, login), time = now();
    if (counters.size + selected.filter(key => !counters.has(key)).length > loginLimits.maxEntries) return false;
    return selected.every((key, index) => {
      const value = counters.get(key);
      return !value || (value.count < [loginLimits.pair, loginLimits.account, loginLimits.source, loginLimits.global][index] && value.blockedUntil <= time);
    });
  }
  function failure(source: string, login: unknown) {
    cleanup();
    for (const [index, key] of keys(source, login).entries()) {
      let value = counters.get(key);
      if (!value) {
        if (counters.size >= loginLimits.maxEntries) continue;
        value = { count: 0, expires: now() + loginLimits.windowMs, blockedUntil: 0 }; counters.set(key, value);
      }
      value.count++;
      if (index === 0 && value.count >= 5) value.blockedUntil = now() + Math.min(60_000, 1000 * 2 ** Math.min(value.count - 5, 6));
    }
  }
  // A success does not erase attack evidence for an account, shared source or global bucket.
  return { check, failure, cleanup, size: () => counters.size };
}
