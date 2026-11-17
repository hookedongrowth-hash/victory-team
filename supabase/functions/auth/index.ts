// Sign-in for the team app: one-time code, then a passkey.
// No email is ever sent. A member claims a code from the coach, registers a
// passkey, and from then on signs in with it. The session itself is a normal
// Supabase Auth session, so row level security in the database does the rest.
//
// Runs with the service role and is the only thing that touches the sign-in
// tables. verify_jwt is off because the caller has no session yet; this file
// does its own checks.

import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from 'npm:@simplewebauthn/server@13.1.1';
import {
  allowedOrigin, b64urlToBytes, bytesToB64url, clientIp, LIMITS, looksLikeCode,
  normalizeCode, sha256Hex, syntheticEmail, tooManyFailures,
} from './lib.ts';

const URL_ = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const RP_ID = Deno.env.get('RP_ID') ?? 'hookedongrowth-hash.github.io';
const ORIGIN = Deno.env.get('ORIGIN') ?? 'https://hookedongrowth-hash.github.io';
const ALLOWED = Deno.env.get('ALLOWED_ORIGINS') ?? ORIGIN;
const RP_NAME = 'Royal Victory H.C. Dames 1';

const admin = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

class Refusal extends Error {
  constructor(public status: number, message: string) { super(message); }
}
const MSG = {
  badCode: 'That code did not work. Check it, or ask the coach for a new one.',
  slow: 'Too many tries. Wait a while and try again.',
  failed: 'That did not work. Try again.',
};

function json(body: unknown, status: number, origin: string | null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      ...(origin ? {
        'access-control-allow-origin': origin,
        'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info',
        'access-control-allow-methods': 'POST, OPTIONS',
        vary: 'origin',
      } : {}),
    },
  });
}

async function failureCounts(ip: string, kind: string) {
  const since = new Date(Date.now() - 3600_000).toISOString();
  const one = await admin.from('auth_attempts').select('id', { count: 'exact', head: true })
    .eq('kind', kind).eq('ip', ip).gte('at', since);
  const all = await admin.from('auth_attempts').select('id', { count: 'exact', head: true })
    .eq('kind', kind).gte('at', since);
  return { ip: one.count ?? 0, all: all.count ?? 0 };
}
async function noteFailure(ip: string, kind: string) {
  await admin.from('auth_attempts').insert({ ip, kind });
  // Tidy as we go. The table never needs more than a day.
  await admin.from('auth_attempts').delete().lt('at', new Date(Date.now() - 86400_000).toISOString());
}

async function newChallenge(opts: { challenge: string; purpose: 'register' | 'login'; member_id?: string; invite_id?: string }) {
  await admin.from('auth_challenges').delete()
    .lt('created_at', new Date(Date.now() - LIMITS.challengeMinutes * 60_000).toISOString());
  const { data, error } = await admin.from('auth_challenges').insert(opts).select('id').single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

/** Takes the challenge and deletes it, so it can only be used once. */
async function takeChallenge(id: string, purpose: 'register' | 'login') {
  const { data } = await admin.from('auth_challenges').delete().eq('id', id).eq('purpose', purpose)
    .gte('created_at', new Date(Date.now() - LIMITS.challengeMinutes * 60_000).toISOString())
    .select('*').maybeSingle();
  if (!data) throw new Refusal(400, 'That took too long. Start again.');
  return data as { challenge: string; member_id: string | null; invite_id: string | null };
}

/** A real Supabase session for this member, without sending any email. */
async function mintSession(memberId: string) {
  const { data: m } = await admin.from('members').select('id, user_id, active').eq('id', memberId).single();
  if (!m || !m.active) throw new Refusal(403, 'This account is switched off. Ask the coach.');
  const email = syntheticEmail(memberId);
  let userId = m.user_id as string | null;
  if (!userId) {
    const created = await admin.auth.admin.createUser({ email, email_confirm: true });
    if (created.error || !created.data.user) throw new Error(created.error?.message ?? 'no user');
    userId = created.data.user.id;
    const { error } = await admin.from('members').update({ user_id: userId }).eq('id', memberId).is('user_id', null);
    if (error) throw new Error(error.message);
  }
  const link = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  const hashed = link.data?.properties?.hashed_token;
  if (link.error || !hashed) throw new Error(link.error?.message ?? 'no link');
  const pub = createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const out = await pub.auth.verifyOtp({ type: 'magiclink', token_hash: hashed });
  if (out.error || !out.data.session) throw new Error(out.error?.message ?? 'no session');
  const s = out.data.session;
  return { access_token: s.access_token, refresh_token: s.refresh_token };
}

async function claimStart(body: any, ip: string) {
  const counts = await failureCounts(ip, 'code');
  if (tooManyFailures(counts.ip, counts.all)) throw new Refusal(429, MSG.slow);
  const norm = normalizeCode(body.code);
  if (!looksLikeCode(norm)) { await noteFailure(ip, 'code'); throw new Refusal(400, MSG.badCode); }
  const { data: inv } = await admin.from('invites')
    .select('id, member_id, expires_at, used_at, members(id, name, active)')
    .eq('code_hash', await sha256Hex(norm)).maybeSingle();
  const member = (inv as any)?.members;
  if (!inv || inv.used_at || new Date(inv.expires_at) < new Date() || !member?.active) {
    await noteFailure(ip, 'code');
    throw new Refusal(400, MSG.badCode);
  }
  const { data: existing } = await admin.from('passkeys').select('credential_id, transports').eq('member_id', member.id);
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: RP_ID,
    userName: member.name,
    userDisplayName: member.name,
    userID: new TextEncoder().encode(member.id),
    attestationType: 'none',
    excludeCredentials: (existing ?? []).map((k: any) => ({ id: k.credential_id, transports: k.transports ?? undefined })),
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
  });
  const challengeId = await newChallenge({ challenge: options.challenge, purpose: 'register', member_id: member.id, invite_id: inv.id });
  return { challengeId, options, name: member.name };
}

async function claimFinish(body: any) {
  const ch = await takeChallenge(String(body.challengeId ?? ''), 'register');
  const { data: inv } = await admin.from('invites').select('id, member_id, expires_at, used_at')
    .eq('id', ch.invite_id).maybeSingle();
  if (!inv || inv.used_at || new Date(inv.expires_at) < new Date() || inv.member_id !== ch.member_id) {
    throw new Refusal(400, MSG.badCode);
  }
  const v = await verifyRegistrationResponse({
    response: body.response,
    expectedChallenge: ch.challenge,
    expectedOrigin: ORIGIN,
    expectedRPID: RP_ID,
    requireUserVerification: true,
  });
  if (!v.verified || !v.registrationInfo) throw new Refusal(400, MSG.failed);
  // Use the code up first. If someone else got there a moment earlier, stop.
  const used = await admin.from('invites').update({ used_at: new Date().toISOString() })
    .eq('id', inv.id).is('used_at', null).select('id');
  if (used.error || !used.data?.length) throw new Refusal(400, MSG.badCode);
  const c = v.registrationInfo.credential;
  const ins = await admin.from('passkeys').insert({
    credential_id: c.id,
    member_id: inv.member_id,
    public_key: bytesToB64url(c.publicKey),
    counter: c.counter,
    transports: c.transports ?? null,
  });
  if (ins.error) throw new Error(ins.error.message);
  const session = await mintSession(inv.member_id);
  return { session };
}

async function loginStart() {
  const options = await generateAuthenticationOptions({ rpID: RP_ID, userVerification: 'required' });
  const challengeId = await newChallenge({ challenge: options.challenge, purpose: 'login' });
  return { challengeId, options };
}

async function loginFinish(body: any, ip: string) {
  const counts = await failureCounts(ip, 'login');
  if (counts.ip >= LIMITS.loginPerIp) throw new Refusal(429, MSG.slow);
  const ch = await takeChallenge(String(body.challengeId ?? ''), 'login');
  const credId = String(body.response?.id ?? '');
  const { data: k } = await admin.from('passkeys').select('*').eq('credential_id', credId).maybeSingle();
  if (!k) { await noteFailure(ip, 'login'); throw new Refusal(400, 'This device is not set up. Use your code first.'); }
  let v;
  try {
    v = await verifyAuthenticationResponse({
      response: body.response,
      expectedChallenge: ch.challenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
      requireUserVerification: true,
      credential: {
        id: k.credential_id,
        publicKey: b64urlToBytes(k.public_key),
        counter: Number(k.counter),
        transports: k.transports ?? undefined,
      },
    });
  } catch { await noteFailure(ip, 'login'); throw new Refusal(400, MSG.failed); }
  if (!v.verified) { await noteFailure(ip, 'login'); throw new Refusal(400, MSG.failed); }
  await admin.from('passkeys').update({
    counter: v.authenticationInfo.newCounter, last_used_at: new Date().toISOString(),
  }).eq('credential_id', k.credential_id);
  return { session: await mintSession(k.member_id) };
}

Deno.serve(async (req) => {
  const origin = allowedOrigin(req.headers.get('origin'), ALLOWED);
  if (req.method === 'OPTIONS') return json({}, origin ? 204 : 403, origin);
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405, origin);
  // Browsers always send Origin on this kind of call. Anything else is not our app.
  if (!origin) return json({ error: 'Not allowed.' }, 403, null);
  try {
    const body = await req.json();
    const ip = clientIp(req.headers);
    switch (body.action) {
      case 'claim-start': return json(await claimStart(body, ip), 200, origin);
      case 'claim-finish': return json(await claimFinish(body), 200, origin);
      case 'login-start': return json(await loginStart(), 200, origin);
      case 'login-finish': return json(await loginFinish(body, ip), 200, origin);
      default: return json({ error: 'Unknown action.' }, 400, origin);
    }
  } catch (e) {
    if (e instanceof Refusal) return json({ error: e.message }, e.status, origin);
    console.error('auth function error:', e instanceof Error ? e.message : 'unknown');
    return json({ error: MSG.failed }, 500, origin);
  }
});
