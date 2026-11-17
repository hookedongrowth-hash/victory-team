// Applies the files in supabase/migrations, in order, once each.
// The only way schema changes reach the hosted project.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from './mgmt.mjs';

const dir = 'supabase/migrations';
await sql(`create table if not exists public.app_migrations (
  version text primary key, applied_at timestamptz not null default now());
alter table public.app_migrations enable row level security;
revoke all on public.app_migrations from anon, authenticated;`);

const done = new Set((await sql('select version from public.app_migrations')).map((r) => r.version));
const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
let applied = 0;
for (const f of files) {
  if (done.has(f)) continue;
  console.log(`Applying ${f}`);
  const body = readFileSync(join(dir, f), 'utf8');
  // Sent as one request, so the file and its record succeed or fail together.
  await sql(`${body}\n;\ninsert into public.app_migrations (version) values ('${f.replace(/'/g, "''")}');`);
  applied++;
}
console.log(`Migrations: ${applied} applied, ${files.length - applied} already there.`);
