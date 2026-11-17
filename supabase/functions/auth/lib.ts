// Pure helpers for the sign-in function. No Deno or network, so tests can run them.

/** "abcde-fghjk" and " ABCDE FGHJK " are the same code. */
export function normalizeCode(input: string): string {
  return String(input ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function looksLikeCode(norm: string): boolean {
  return /^[A-HJKMNP-Z2-9]{10}$/.test(norm);
}

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const LIMITS = {
  /** Wrong codes from one address in an hour. */
  perIpFailures: 12,
  /** Wrong codes from everywhere in an hour, so a spread-out guess cannot work. */
  globalFailures: 3000,
  /** Passkey sign-in failures from one address in an hour. */
  loginPerIp: 40,
  /** Sign in prompts requested from one address in an hour. */
  loginStartPerIp: 150,
  challengeMinutes: 5,
};

export function tooManyFailures(ipFailures: number, globalFailures: number): boolean {
  return ipFailures >= LIMITS.perIpFailures || globalFailures >= LIMITS.globalFailures;
}

export function clientIp(headers: Headers): string {
  // The platform's own header first. Otherwise the LAST forwarded entry, which
  // the proxy added, never the first, which a caller can write themselves.
  const cf = headers.get('cf-connecting-ip');
  if (cf) return cf.trim();
  const parts = (headers.get('x-forwarded-for') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return parts[parts.length - 1] || 'unknown';
}

/** Which origins may call the function. Exact match only. */
export function allowedOrigin(origin: string | null, list: string): string | null {
  if (!origin) return null;
  const ok = list.split(',').map((s) => s.trim()).filter(Boolean);
  return ok.includes(origin) ? origin : null;
}

export function syntheticEmail(memberId: string): string {
  return `${memberId}@members.victory.invalid`;
}

export function b64urlToBytes(s: string): Uint8Array {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export function bytesToB64url(b: Uint8Array): string {
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
