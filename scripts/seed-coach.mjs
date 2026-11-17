// Prints the SQL that makes sure there is a coach and, until the coach has a
// passkey (or when COACH_RESET=1), one waiting one-time code. The code is the
// COACH_FIRST_CODE secret. Only its hash is written. Pipe the output to psql:
//   node scripts/seed-coach.mjs | psql "$DB_URL" -v ON_ERROR_STOP=1 -q
import { createHash } from 'node:crypto';

const code = String(process.env.COACH_FIRST_CODE ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
if (!/^[A-HJKMNP-Z2-9]{10}$/.test(code)) {
  console.error('COACH_FIRST_CODE is not set or not in the right shape. Skipping the coach code.');
  console.log('select 1;');
  process.exit(0);
}
const hash = createHash('sha256').update(code).digest('hex');
const name = /^[\p{L} '.-]{1,60}$/u.test(process.env.COACH_NAME ?? '') ? process.env.COACH_NAME : 'Coach';
const reset = process.env.COACH_RESET === '1';

console.log(`do $$
declare v uuid;
begin
  select id into v from public.members where role = 'coach' order by created_at limit 1;
  if v is null then
    insert into public.members (name, role) values ('${name.replace(/'/g, "''")}', 'coach') returning id into v;
  end if;
  if ${reset ? 'true' : 'not exists (select 1 from public.passkeys where member_id = v)'} then
    delete from public.invites where member_id = v and (used_at is null or code_hash = '${hash}');
    insert into public.invites (member_id, code_hash, expires_at)
    values (v, '${hash}', now() + interval '14 days');
  end if;
end $$;`);
