import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { addUser, as, freshDb, refused } from './harness';

let db: PGlite;
let coach: { userId: string };
let ann: { userId: string };

const OPEN = `select public.quiz_open($1) as r`;
const JOIN = `select public.quiz_join($1) as id`;
const QUESTIONS = `select seq, photo, options from public.quiz_questions($1)`;
const ANSWER = `select public.quiz_answer($1, $2, $3) as r`;
const STATE = `select public.quiz_state() as s`;

/** Ask the real answer from the database's side, the way a cheater cannot. */
async function rightName(playerId: string, seq: number): Promise<string> {
  const q = await db.query<{ name: string }>(
    `select o.name from (
       select pe.name, row_number() over (order by md5($1::text || pe.id::text)) as seq from public.quiz_people pe
     ) o where o.seq = $2`, [playerId, seq]);
  return q.rows[0].name;
}

beforeAll(async () => {
  db = await freshDb();
  coach = await addUser(db, 'Coach', 'coach');
  ann = await addUser(db, 'Ann', 'player');
});

describe('quiz', () => {
  it('starts idle and closed to the tables', async () => {
    const s = await as(db, null, STATE);
    expect((s.rows[0] as any).s.status).toBe('idle');
    for (const t of ['quiz_people', 'quiz_rounds', 'quiz_players', 'quiz_answers']) {
      expect(await refused(db, null, `select * from public.${t}`)).toBe(true);
      expect(await refused(db, ann.userId, `select * from public.${t}`)).toBe(true);
    }
  });

  it('only the coach can open a round, and nobody can join before then', async () => {
    expect(await refused(db, null, OPEN, [90])).toBe(true);
    expect(await refused(db, ann.userId, OPEN, [90])).toBe(true);
    expect(await refused(db, null, JOIN, ['Early'])).toBe(true);
    const r = await as(db, coach.userId, OPEN, [90]);
    expect((r.rows[0] as any).r.seconds).toBe(90);
    expect(await refused(db, coach.userId, OPEN, [90])).toBe(true); // one at a time
  });

  let pid: string;
  it('an anonymous player joins, and sees four names and no answers', async () => {
    const j = await as(db, null, JOIN, ['Fien']);
    pid = (j.rows[0] as any).id;
    expect(await refused(db, null, JOIN, ['  fien '])).toBe(true); // same name, other case
    const q = await as(db, null, QUESTIONS, [pid]);
    expect(q.rows).toHaveLength(22);
    for (const row of q.rows as any[]) {
      expect(row.options).toHaveLength(4);
      expect(new Set(row.options).size).toBe(4);
    }
    expect(Object.keys(q.rows[0])).toEqual(['seq', 'photo', 'options']);
    // A stranger's id gets nothing.
    const none = await as(db, null, QUESTIONS, ['00000000-0000-0000-0000-000000000000']);
    expect(none.rows).toHaveLength(0);
  });

  it('checks answers, counts the first one only, and names the right one when wrong', async () => {
    const right1 = await rightName(pid, 1);
    const a1 = await as(db, null, ANSWER, [pid, 1, right1]);
    expect((a1.rows[0] as any).r).toEqual({ correct: true, answer: null });
    const a2 = await as(db, null, ANSWER, [pid, 2, 'Nobody Atall']);
    expect((a2.rows[0] as any).r).toEqual({ correct: false, answer: await rightName(pid, 2) });
    // Trying again with the right name does not change the result.
    const again = await as(db, null, ANSWER, [pid, 2, await rightName(pid, 2)]);
    expect((again.rows[0] as any).r.correct).toBe(false);
    expect(await refused(db, null, ANSWER, [pid, 99, 'x'])).toBe(true);
  });

  it('ranks by right answers, then by who got there first, and shows scores only after it closes', async () => {
    const other = (await as(db, null, JOIN, ['Lotte'])).rows[0] as any;
    for (let s = 1; s <= 3; s++) await as(db, null, ANSWER, [other.id, s, await rightName(other.id, s)]);
    expect(((await as(db, null, STATE)).rows[0] as any).s).not.toHaveProperty('board');
    expect(((await as(db, null, STATE)).rows[0] as any).s.players).toBe(2);
    // Fien has 1 right, Lotte 3. Then Fien catches up to 3, but later.
    for (let s = 2; s <= 3; s++) await as(db, null, ANSWER, [pid, s, await rightName(pid, s)]);
    await db.exec(`update public.quiz_answers set answered_at = now() - interval '10 seconds' where player_id = '${other.id}'`);
    // Close the round.
    await db.exec(`update public.quiz_rounds set opened_at = now() - interval '2 minutes', closes_at = now() - interval '1 second'`);
    expect(await refused(db, null, ANSWER, [pid, 5, 'x'])).toBe(true); // too late
    const s = ((await as(db, null, STATE)).rows[0] as any).s;
    expect(s.status).toBe('closed');
    expect(s.board.map((b: any) => b.name)).toEqual(['Lotte', 'Fien']);
    expect(s.board[0].score).toBe(3);
    expect(await refused(db, null, QUESTIONS, [pid]) ).toBe(false);
    expect((await as(db, null, QUESTIONS, [pid])).rows).toHaveLength(0); // nothing after the buzzer
  });

  it('only the coach reads every answer', async () => {
    expect(await refused(db, null, `select public.quiz_results()`)).toBe(true);
    expect(await refused(db, ann.userId, `select public.quiz_results()`)).toBe(true);
    const r = ((await as(db, coach.userId, `select public.quiz_results() as r`)).rows[0] as any).r;
    expect(r.players[0].name).toBe('Lotte');
    expect(r.players[0].answers).toHaveLength(3);
    expect(r.players[1].answers.find((a: any) => a.seq === 2).correct).toBe(false);
    expect(r.players[1].answers.find((a: any) => a.seq === 3).correct).toBe(true);
    expect(r.players[1].answers.find((a: any) => a.seq === 1).who).toBeTruthy();
  });

  it('the coach can stop a round early, and then start another', async () => {
    await as(db, coach.userId, OPEN, [60]);
    expect(await refused(db, ann.userId, `select public.quiz_stop()`)).toBe(true);
    await as(db, coach.userId, `select public.quiz_stop()`);
    await db.exec(`update public.quiz_rounds set closes_at = now() - interval '1 second', opened_at = now() - interval '5 seconds' where closes_at > now()`);
    expect(((await as(db, null, STATE)).rows[0] as any).s.status).toBe('closed');
    await as(db, coach.userId, OPEN, [90]);
  });
});
