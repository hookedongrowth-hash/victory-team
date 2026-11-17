import { describe, expect, it } from 'vitest';
import {
  allowedOrigin, b64urlToBytes, bytesToB64url, clientIp, looksLikeCode, normalizeCode,
  sha256Hex, syntheticEmail, tooManyFailures,
} from '../../supabase/functions/auth/lib';

describe('codes', () => {
  it('ignores case, spaces and dashes', () => {
    expect(normalizeCode(' abcde-fghjk ')).toBe('ABCDEFGHJK');
    expect(looksLikeCode(normalizeCode('abcde-fghjk'))).toBe(true);
  });
  it('rejects the wrong shape and confusing letters', () => {
    expect(looksLikeCode('SHORT')).toBe(false);
    expect(looksLikeCode('ABCDEFGHIL')).toBe(false); // I and L are never issued
    expect(looksLikeCode('ABCDEFGHJ0')).toBe(false);
  });
  it('hashes the same way the database does', async () => {
    // sha256 of "ABC", checked against a known value.
    expect(await sha256Hex('ABC')).toBe('b5d4045c3f466fa91fe2cc6abe79232a1a57cdf104f7a26e716e0a1e2789df78');
  });
});

describe('limits', () => {
  it('stops one address and a spread-out guess', () => {
    expect(tooManyFailures(0, 0)).toBe(false);
    expect(tooManyFailures(12, 12)).toBe(true);
    expect(tooManyFailures(1, 3000)).toBe(true);
    expect(tooManyFailures(1, 200)).toBe(false);
  });
  it('trusts the platform header, then the last forwarded address, never the first', () => {
    expect(clientIp(new Headers({ 'cf-connecting-ip': '9.9.9.9', 'x-forwarded-for': '1.2.3.4' }))).toBe('9.9.9.9');
    expect(clientIp(new Headers({ 'x-forwarded-for': '6.6.6.6, 5.6.7.8' }))).toBe('5.6.7.8');
    expect(clientIp(new Headers())).toBe('unknown');
  });
});

describe('origins', () => {
  it('allows exact matches only', () => {
    const list = 'https://a.example, http://localhost:4173';
    expect(allowedOrigin('https://a.example', list)).toBe('https://a.example');
    expect(allowedOrigin('https://a.example.evil.com', list)).toBeNull();
    expect(allowedOrigin(null, list)).toBeNull();
  });
});

describe('encoding', () => {
  it('round trips base64url', () => {
    const bytes = new Uint8Array([0, 250, 251, 252, 253, 254, 255, 1]);
    expect(Array.from(b64urlToBytes(bytesToB64url(bytes)))).toEqual(Array.from(bytes));
  });
  it('builds the private sign-in address', () => {
    expect(syntheticEmail('abc')).toBe('abc@members.victory.invalid');
  });
});
