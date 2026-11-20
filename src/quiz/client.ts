import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const URL_ = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const configured = Boolean(URL_ && KEY);
export const BASE = import.meta.env.BASE_URL;
export const photoUrl = (file: string) => `${BASE}quiz-photos/${file}`;

/** The players have no account. This client keeps no session at all. */
export const anon: SupabaseClient = createClient(URL_ ?? 'http://localhost:54321', KEY ?? 'missing', {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

export interface BoardRow { name: string; score: number; answered: number }
export interface State {
  status: 'idle' | 'open' | 'closed';
  round_id?: string; opened_at?: string; closes_at?: string; seconds?: number; players?: number;
  now: string; board?: BoardRow[];
  /** Server clock minus this phone's clock, in milliseconds. */
  offset: number;
}

export async function getState(client: SupabaseClient = anon): Promise<State> {
  const t0 = Date.now();
  const { data, error } = await client.rpc('quiz_state');
  if (error) throw error;
  const t1 = Date.now();
  const s = data as Omit<State, 'offset'>;
  return { ...s, offset: Date.parse(s.now) - (t0 + t1) / 2 };
}

/** When the round ends, on this phone's own clock. */
export const endsAt = (s: State) => Date.parse(s.closes_at!) - s.offset;

/** Messages we wrote in the database are shown as they are. Everything else is a connection problem. */
export function say(err: unknown): string {
  const e = err as { code?: string; message?: string };
  if (e?.code === 'P0001' && e.message) return e.message;
  return 'No connection. Check your internet and try again.';
}

export const isTimeUp = (err: unknown) => (err as any)?.code === 'P0001' && /time is up/i.test((err as any)?.message ?? '');

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
