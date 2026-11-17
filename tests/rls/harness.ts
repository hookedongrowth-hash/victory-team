// Runs the real migrations in an in-process Postgres (PGlite) with a stand-in
// for the parts Supabase provides (auth schema, roles, storage tables).
import { PGlite } from '@electric-sql/pglite';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const STUB = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema extensions;
create schema auth;
create schema storage;
grant usage on schema public, extensions, auth, storage to anon, authenticated, service_role;
create table auth.users (id uuid primary key default gen_random_uuid(), email text);
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
-- Stand-ins for pgcrypto, which Supabase keeps in the "extensions" schema.
create function extensions.digest(t text, algo text) returns bytea language sql immutable as
  $$ select sha256(convert_to(t, 'UTF8')) $$;
create function extensions.gen_random_bytes(n int) returns bytea language sql volatile as
  $$ select decode(string_agg(lpad(to_hex((random() * 255)::int), 2, '0'), ''), 'hex') from generate_series(1, n) $$;
grant execute on function auth.uid() to anon, authenticated;
create table storage.buckets (id text primary key, name text, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text,
  name text, owner uuid);
alter table storage.objects enable row level security;
grant all on storage.objects, storage.buckets to authenticated, anon;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
`;

export async function freshDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(STUB);
  const dir = join(import.meta.dirname, '../../supabase/migrations');
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    // PGlite has no pgcrypto, so the stub above stands in for it.
    const sql = readFileSync(join(dir, f), 'utf8').replace(/create extension if not exists pgcrypto[^;]*;/i, '');
    await db.exec(sql);
  }
  return db;
}

export type Who = string | null; // a user id, or null for the anon key

export async function as<T = any>(db: PGlite, who: Who, sql: string, params: any[] = []) {
  await db.exec(
    `set role ${who ? 'authenticated' : 'anon'}; select set_config('request.jwt.claim.sub', '${who ?? ''}', false);`,
  );
  try {
    return await db.query<T>(sql, params);
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
  }
}

/** Resolves true if the statement is refused (error), false if it worked. */
export async function refused(db: PGlite, who: Who, sql: string, params: any[] = []) {
  try { await as(db, who, sql, params); return false; } catch { return true; }
}

export async function addUser(db: PGlite, name: string, role: 'coach' | 'player') {
  const u = await db.query<{ id: string }>(`insert into auth.users (email) values ($1) returning id`, [`${name}@x.invalid`]);
  const m = await db.query<{ id: string }>(
    `insert into public.members (name, role, user_id) values ($1, $2, $3) returning id`, [name, role, u.rows[0].id]);
  return { userId: u.rows[0].id, memberId: m.rows[0].id };
}
