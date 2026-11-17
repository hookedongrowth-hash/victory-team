import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { addUser, as, freshDb, refused } from './harness';

let db: PGlite;
let coach: { userId: string; memberId: string };
let ann: { userId: string; memberId: string };
let bea: { userId: string; memberId: string };
let cat: { userId: string; memberId: string };

const review = (date: string, well = 'Pressing') =>
  [date, 'Leopold', 4, well, 'Passing', 'Good team game', null, null, false, null];
const SUBMIT = `select public.submit_reflection($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`;

beforeAll(async () => {
  db = await freshDb();
  coach = await addUser(db, 'Coach', 'coach');
  ann = await addUser(db, 'Ann', 'player');
  bea = await addUser(db, 'Bea', 'player');
  cat = await addUser(db, 'Cat', 'player');
  // Both players send a review, with a secret-ish note in each.
  await as(db, ann.userId, SUBMIT, ['2026-11-14', 'Leopold', 4, 'Ann went well', 'Ann work on', null, bea.memberId, 'Bea ran so hard', false, 'Ann private words to coach']);
  await as(db, bea.userId, SUBMIT, ['2026-11-14', 'Leopold', 2, 'Bea went well', 'Bea work on', null, cat.memberId, 'Cat was calm', true, null]);
  // The coach writes feedback.
  for (const [aud, pid, body] of [
    ['player', ann.memberId, 'For Ann only'],
    ['player', bea.memberId, 'For Bea only'],
    ['team', null, 'For the whole team'],
  ] as const) {
    await as(db, coach.userId,
      `insert into public.feedback (audience, player_id, topic, body) values ($1, $2, 'general', $3)`, [aud, pid, body]);
  }
  // One published file, one draft.
  await db.exec(`
    insert into public.files (kind, title, storage_path, mime, published_at) values
      ('tactics', 'Press slides', 'a/press.pdf', 'application/pdf', now()),
      ('briefing', 'Draft briefing', 'b/draft.pdf', 'application/pdf', null);
    insert into storage.objects (bucket_id, name) values
      ('team-files', 'a/press.pdf'), ('team-files', 'b/draft.pdf');`);
});

describe('two players cannot see each other', () => {
  it('each sees only her own reflection', async () => {
    const a = await as(db, ann.userId, `select player_id, went_well from public.reflections`);
    expect(a.rows).toHaveLength(1);
    expect(a.rows[0]).toMatchObject({ player_id: ann.memberId, went_well: 'Ann went well' });
    const b = await as(db, bea.userId, `select player_id, went_well from public.reflections`);
    expect(b.rows).toHaveLength(1);
    expect(b.rows[0]).toMatchObject({ player_id: bea.memberId, went_well: 'Bea went well' });
  });

  it('asking for the other player by id returns nothing', async () => {
    const r = await as(db, ann.userId, `select * from public.reflections where player_id = $1`, [bea.memberId]);
    expect(r.rows).toHaveLength(0);
  });

  it('each sees her own feedback plus team feedback, never the other\'s', async () => {
    const a = await as(db, ann.userId, `select body from public.feedback order by body`);
    expect(a.rows.map((r: any) => r.body)).toEqual(['For Ann only', 'For the whole team']);
    const b = await as(db, bea.userId, `select body from public.feedback order by body`);
    expect(b.rows.map((r: any) => r.body)).toEqual(['For Bea only', 'For the whole team']);
    const c = await as(db, cat.userId, `select body from public.feedback`);
    expect(c.rows.map((r: any) => r.body)).toEqual(['For the whole team']);
  });

  it('a player sees only her own member row', async () => {
    const r = await as(db, ann.userId, `select name from public.members`);
    expect(r.rows).toEqual([{ name: 'Ann' }]);
  });

  it('the squad list gives names and ids only, players only', async () => {
    const r = await as(db, ann.userId, `select * from public.squad()`);
    expect(r.rows.map((x: any) => x.name)).toEqual(['Ann', 'Bea', 'Cat']);
    expect(Object.keys(r.rows[0]).sort()).toEqual(['id', 'name']);
  });

  it('praise, anonymous notes, invites and passkeys are closed to players', async () => {
    for (const t of ['teammate_praise', 'coach_notes']) {
      expect((await as(db, ann.userId, `select * from public.${t}`)).rows).toHaveLength(0);
    }
    for (const t of ['invites', 'passkeys', 'auth_challenges', 'auth_attempts']) {
      expect(await refused(db, ann.userId, `select * from public.${t}`)).toBe(true);
    }
  });

  it('a player cannot write to tables or edit the other player\'s review', async () => {
    expect(await refused(db, ann.userId, `insert into public.reflections (player_id, match_date, rating) values ($1, '2026-11-20', 5)`, [ann.memberId])).toBe(true);
    expect(await refused(db, ann.userId, `update public.reflections set rating = 1`)).toBe(true);
    expect(await refused(db, ann.userId, `delete from public.reflections`)).toBe(true);
    expect(await refused(db, ann.userId, `insert into public.feedback (audience, topic, body) values ('team','general','hi')`)).toBe(true);
    expect(await refused(db, ann.userId, `update public.members set role = 'coach'`)).toBe(true);
    expect(await refused(db, ann.userId, `insert into public.files (kind,title,storage_path,mime) values ('other','x','x/y','application/pdf')`)).toBe(true);
  });

  it('a player cannot use coach functions', async () => {
    expect(await refused(db, ann.userId, `select public.issue_invite($1)`, [bea.memberId])).toBe(true);
    expect(await refused(db, ann.userId, `select public.add_player('Dee')`)).toBe(true);
    expect(await refused(db, ann.userId, `select * from public.coach_squad()`)).toBe(true);
    expect(await refused(db, ann.userId, `select public.set_member_active($1, false)`, [bea.memberId])).toBe(true);
  });

  it('a player cannot mark the other player\'s feedback as read', async () => {
    const f = await db.query<{ id: string }>(`select id from public.feedback where body = 'For Bea only'`);
    expect(await refused(db, ann.userId, `select public.mark_feedback_read($1)`, [f.rows[0].id])).toBe(true);
    const t = await db.query<{ id: string }>(`select id from public.feedback where audience = 'team'`);
    expect(await refused(db, ann.userId, `select public.mark_feedback_read($1)`, [t.rows[0].id])).toBe(false);
  });

  it('files: players see published only, in the table and in storage', async () => {
    const t = await as(db, ann.userId, `select title from public.files`);
    expect(t.rows).toEqual([{ title: 'Press slides' }]);
    const o = await as(db, bea.userId, `select name from storage.objects`);
    expect(o.rows).toEqual([{ name: 'a/press.pdf' }]);
    expect(await refused(db, ann.userId, `insert into storage.objects (bucket_id, name) values ('team-files','a/evil.pdf')`)).toBe(true);
  });

  it('anonymous visitors see nothing and can only ping', async () => {
    for (const t of ['members', 'reflections', 'feedback', 'files', 'teammate_praise', 'coach_notes']) {
      expect(await refused(db, null, `select * from public.${t}`)).toBe(true);
    }
    expect((await as(db, null, `select public.ping() as p`)).rows[0]).toEqual({ p: 1 });
    expect(await refused(db, null, `select * from public.squad()`)).toBe(true);
    expect(await refused(db, null, `select public.me()`)).toBe(true);
  });

  it('a switched-off player sees nothing at all', async () => {
    const dee = await addUser(db, 'Dee', 'player');
    await as(db, dee.userId, SUBMIT, review('2026-11-01'));
    await as(db, coach.userId, `select public.set_member_active($1, false)`, [dee.memberId]);
    expect((await as(db, dee.userId, `select * from public.reflections`)).rows).toHaveLength(0);
    expect((await as(db, dee.userId, `select * from public.feedback`)).rows).toHaveLength(0);
    expect(await refused(db, dee.userId, SUBMIT, review('2026-11-02'))).toBe(true);
  });
});

describe('what the coach sees', () => {
  it('sees every reflection, praise and note', async () => {
    expect((await as(db, coach.userId, `select * from public.reflections`)).rows.length).toBeGreaterThanOrEqual(2);
    const p = await as(db, coach.userId, `select note from public.teammate_praise order by note`);
    expect(p.rows.map((r: any) => r.note)).toEqual(['Bea ran so hard', 'Cat was calm']);
    const n = await as(db, coach.userId, `select body, nothing_to_change from public.coach_notes order by body nulls last`);
    expect(n.rows).toEqual([
      { body: 'Ann private words to coach', nothing_to_change: false },
      { body: null, nothing_to_change: true },
    ]);
  });

  it('the anonymous note has no link to any player', async () => {
    const cols = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns where table_name = 'coach_notes' order by 1`);
    expect(cols.rows.map((c) => c.column_name)).toEqual(['body', 'id', 'match_date', 'nothing_to_change']);
  });

  it('can manage the squad and write feedback', async () => {
    const id = (await as(db, coach.userId, `select public.add_player('Eve') as id`)).rows[0].id;
    expect(id).toBeTruthy();
    expect(await refused(db, coach.userId, `select public.add_player('Eve')`)).toBe(true);
    const s = await as(db, coach.userId, `select name, has_login from public.coach_squad() where role = 'player' order by name`);
    expect(s.rows.find((r: any) => r.name === 'Eve')).toMatchObject({ has_login: false });
  });

  it('cannot switch off her own access', async () => {
    expect(await refused(db, coach.userId, `select public.set_member_active($1, false)`, [coach.memberId])).toBe(true);
  });
});

describe('sending a review', () => {
  it('checks the content', async () => {
    expect(await refused(db, ann.userId, SUBMIT, ['2026-11-15', null, 9, 'a', 'b', null, null, null, false, null])).toBe(true);
    expect(await refused(db, ann.userId, SUBMIT, ['2026-11-15', null, 3, '  ', 'b', null, null, null, false, null])).toBe(true);
    expect(await refused(db, ann.userId, SUBMIT, ['2026-11-15', null, 3, 'a', '', null, null, null, false, null])).toBe(true);
  });
  it('refuses praise for yourself or a non-player', async () => {
    expect(await refused(db, ann.userId, SUBMIT, ['2026-11-16', null, 3, 'a', 'b', null, ann.memberId, 'me', false, null])).toBe(true);
    expect(await refused(db, ann.userId, SUBMIT, ['2026-11-16', null, 3, 'a', 'b', null, coach.memberId, 'coach', false, null])).toBe(true);
  });
  it('the coach cannot send a player review', async () => {
    expect(await refused(db, coach.userId, SUBMIT, review('2026-11-17'))).toBe(true);
  });
  it('sending twice updates the review and does not duplicate the note', async () => {
    const before = (await db.query<{ n: number }>(`select count(*)::int as n from public.coach_notes`)).rows[0].n;
    await as(db, ann.userId, SUBMIT, ['2026-11-14', 'Leopold', 5, 'Better words', 'Same', null, null, null, false, 'Ann private words to coach']);
    const r = await as(db, ann.userId, `select rating, went_well from public.reflections where match_date = '2026-11-14'`);
    expect(r.rows).toEqual([{ rating: 5, went_well: 'Better words' }]);
    const after = (await db.query<{ n: number }>(`select count(*)::int as n from public.coach_notes`)).rows[0].n;
    expect(after).toBe(before);
  });
});

describe('one-time codes', () => {
  it('issues a code once, stores only its hash, and replaces an open one', async () => {
    const c1 = (await as(db, coach.userId, `select public.issue_invite($1) as c`, [cat.memberId])).rows[0].c;
    expect(c1).toMatch(/^[A-HJKMNP-Z2-9]{5}-[A-HJKMNP-Z2-9]{5}$/);
    const norm = c1.replace('-', '');
    const hash = (await db.query<{ h: string }>(`select encode(extensions.digest($1, 'sha256'), 'hex') as h`, [norm])).rows[0].h;
    const rows = await db.query<{ code_hash: string }>(`select code_hash from public.invites where member_id = $1`, [cat.memberId]);
    expect(rows.rows).toEqual([{ code_hash: hash }]);
    const c2 = (await as(db, coach.userId, `select public.issue_invite($1) as c`, [cat.memberId])).rows[0].c;
    expect(c2).not.toBe(c1);
    expect((await db.query(`select 1 from public.invites where member_id = $1`, [cat.memberId])).rows).toHaveLength(1);
  });
});

describe('guard rails for the future', () => {
  it('every table in public has row level security switched on', async () => {
    const r = await db.query<{ tablename: string }>(
      `select tablename from pg_tables where schemaname = 'public' and not rowsecurity`);
    expect(r.rows).toEqual([]);
  });
  it('players and anon cannot truncate', async () => {
    expect(await refused(db, ann.userId, `truncate public.feedback`)).toBe(true);
    expect(await refused(db, ann.userId, `truncate public.files`)).toBe(true);
  });
  it('functions open to anon are only ping', async () => {
    const r = await db.query<{ proname: string }>(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute') order by 1`);
    expect(r.rows.map((x) => x.proname)).toEqual(['ping']);
  });
});
