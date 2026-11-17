import { createClient, type Session } from '@supabase/supabase-js';
import { startAuthentication, startRegistration, browserSupportsWebAuthn } from '@simplewebauthn/browser';

const URL_ = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const configured = Boolean(URL_ && KEY);

export const sb = createClient(URL_ ?? 'http://localhost:54321', KEY ?? 'missing', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'victory-session' },
});

export interface Me { id: string; name: string; role: 'coach' | 'player' }

async function callAuth(body: Record<string, unknown>) {
  let res: Response;
  try {
    res = await fetch(`${URL_}/functions/v1/auth`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: KEY!, authorization: `Bearer ${KEY}` },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error('No connection. Check your internet and try again.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? 'That did not work. Try again.');
  return data;
}

async function adopt(session: { access_token: string; refresh_token: string }) {
  const { error } = await sb.auth.setSession(session);
  if (error) throw new Error('Could not sign you in. Try again.');
}

export const passkeysSupported = () => browserSupportsWebAuthn();

// Sign in with a passkey. The options are fetched ahead of time so the
// phone's prompt opens straight from the tap.
export type LoginTicket = { challengeId: string; options: any; at: number };
export async function prepareLogin(): Promise<LoginTicket> {
  const d = await callAuth({ action: 'login-start' });
  return { ...d, at: Date.now() };
}
export async function loginWithPasskey(ticket: LoginTicket) {
  const response = await startAuthentication({ optionsJSON: ticket.options });
  const d = await callAuth({ action: 'login-finish', challengeId: ticket.challengeId, response });
  await adopt(d.session);
}

// First time: a code from the coach, then a new passkey.
export async function startClaim(code: string) {
  return callAuth({ action: 'claim-start', code }) as Promise<{ challengeId: string; options: any; name: string }>;
}
export async function finishClaim(ticket: { challengeId: string; options: any }) {
  let response;
  try {
    response = await startRegistration({ optionsJSON: ticket.options });
  } catch (e: any) {
    if (e?.name === 'InvalidStateError') throw new Error('This phone already has a login. Go back and use Sign in.');
    if (e?.name === 'NotAllowedError') throw new Error('The login was cancelled. Tap the button to try again.');
    throw new Error('This phone could not create the login. Try Safari or Chrome on a phone with Face ID or a fingerprint.');
  }
  const d = await callAuth({ action: 'claim-finish', challengeId: ticket.challengeId, response });
  await adopt(d.session);
}

export async function currentSession(): Promise<Session | null> {
  const { data } = await sb.auth.getSession();
  return data.session;
}

export async function loadMe(): Promise<Me | null> {
  const s = await currentSession();
  if (!s) return null;
  const { data, error } = await sb.from('members').select('id, name, role').eq('user_id', s.user.id).maybeSingle();
  if (error || !data) return null;
  return data as Me;
}

export async function signOut() {
  await sb.auth.signOut({ scope: 'local' });
}

export function say(err: unknown): string {
  const m = (err as any)?.message ?? '';
  return typeof m === 'string' && m && !/^(TypeError|Failed to fetch)/.test(m)
    ? m.replace(/^.*?error: /i, '')
    : 'That did not work. Check your connection and try again.';
}
