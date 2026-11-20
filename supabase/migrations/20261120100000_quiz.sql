-- "Name the H1 player": a short photo quiz the coach opens for a minute or two.
--
-- Anyone with the link can play without an account, so nothing here is open to
-- the app directly. The tables are closed, and the anon key reaches them only
-- through the functions below. The right answer never leaves the database
-- before the answer is sent: the questions carry the photo and four names, and
-- each answer is checked here.

create table public.quiz_people (
  id    int primary key,
  name  text not null,
  photo text not null
);

create table public.quiz_rounds (
  id         uuid primary key default gen_random_uuid(),
  opened_at  timestamptz not null default now(),
  closes_at  timestamptz not null,
  seconds    int not null check (seconds between 30 and 600),
  check (closes_at > opened_at)
);

create table public.quiz_players (
  id        uuid primary key default gen_random_uuid(),
  round_id  uuid not null references public.quiz_rounds (id) on delete cascade,
  name      text not null check (length(btrim(name)) between 1 and 24),
  joined_at timestamptz not null default now()
);
create unique index quiz_players_name_idx on public.quiz_players (round_id, lower(btrim(name)));

create table public.quiz_answers (
  player_id   uuid not null references public.quiz_players (id) on delete cascade,
  seq         int not null check (seq between 1 and 200),
  person_id   int not null references public.quiz_people (id),
  choice      text not null,
  correct     boolean not null,
  answered_at timestamptz not null default now(),
  primary key (player_id, seq)
);

alter table public.quiz_people  enable row level security;
alter table public.quiz_rounds  enable row level security;
alter table public.quiz_players enable row level security;
alter table public.quiz_answers enable row level security;
revoke all on public.quiz_people, public.quiz_rounds, public.quiz_players, public.quiz_answers
  from anon, authenticated;

insert into public.quiz_people (id, name, photo) values
  (1,  'Nick Visker',            'q01.jpg'),
  (2,  'Oscar Coolen',           'q02.jpg'),
  (3,  'Gregoire Scheppers',     'q03.jpg'),
  (4,  'Sibe Poelmans',          'q04.jpg'),
  (5,  'Geronimo Clement',       'q05.jpg'),
  (6,  'Adriaan Lucas',          'q06.jpg'),
  (7,  'Oriol Sacristán Gil',    'q07.jpg'),
  (8,  'Max Scheepers',          'q08.jpg'),
  (9,  'Mats Vanfleteren',       'q09.jpg'),
  (10, 'Arthur da Costa Senior', 'q10.jpg'),
  (11, 'Bas Jansen',             'q11.jpg'),
  (12, 'Louis Vanfleteren',      'q12.jpg'),
  (13, 'Bo Boydens',             'q13.jpg'),
  (14, 'Tim Winthagen',          'q14.jpg'),
  (15, 'Lysander Burmann',       'q15.jpg'),
  (16, 'Jules Coolen',           'q16.jpg'),
  (17, 'Davide Giuliani',        'q17.jpg'),
  (18, 'Rune Vinoelst',          'q18.jpg'),
  (19, 'Mateo De Boeck',         'q19.jpg'),
  (20, 'Alexander Delrue',       'q20.jpg'),
  (21, 'Tobias Lucas',           'q21.jpg'),
  (22, 'Dries Verbaendert',      'q22.jpg');

-- ── Scores (inside only) ─────────────────────────────────────────────────────
-- Most right answers wins. A tie goes to whoever got her last right answer first.
create function public.quiz_board(p_round uuid)
returns table (player_id uuid, name text, score int, answered int, finished_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select pl.id, pl.name,
         (count(*) filter (where a.correct))::int,
         (count(a.seq))::int,
         max(a.answered_at) filter (where a.correct)
  from public.quiz_players pl
  left join public.quiz_answers a on a.player_id = pl.id
  where pl.round_id = p_round
  group by pl.id, pl.name, pl.joined_at
  order by 3 desc, 5 asc nulls last, pl.joined_at
$$;
revoke all on function public.quiz_board(uuid) from public, anon, authenticated;

-- ── What everyone can ask ────────────────────────────────────────────────────
-- The state of the latest round. The scores appear only once it has closed.
create function public.quiz_state() returns json
language plpgsql stable security definer set search_path = '' as $$
declare
  r public.quiz_rounds;
  n int;
begin
  select * into r from public.quiz_rounds order by opened_at desc limit 1;
  if not found then
    return json_build_object('status', 'idle', 'now', now());
  end if;
  select count(*) into n from public.quiz_players where round_id = r.id;
  if now() < r.closes_at then
    return json_build_object('status', 'open', 'round_id', r.id, 'opened_at', r.opened_at,
      'closes_at', r.closes_at, 'seconds', r.seconds, 'players', n, 'now', now());
  end if;
  return json_build_object('status', 'closed', 'round_id', r.id, 'closes_at', r.closes_at,
    'players', n, 'now', now(),
    'board', coalesce((
      select json_agg(json_build_object('name', b.name, 'score', b.score, 'answered', b.answered)
                      order by b.score desc, b.finished_at asc nulls last)
      from (select * from public.quiz_board(r.id) limit 10) b), '[]'::json));
end $$;
revoke all on function public.quiz_state() from public;
grant execute on function public.quiz_state() to anon, authenticated;

-- Join the open round. Returns her player id, which is her only key.
create function public.quiz_join(p_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  r public.quiz_rounds;
  nm text := btrim(coalesce(p_name, ''));
  pid uuid;
begin
  if length(nm) < 1 or length(nm) > 24 then
    raise exception 'Type your name, up to 24 letters.';
  end if;
  select * into r from public.quiz_rounds where closes_at > now() order by opened_at desc limit 1;
  if not found then raise exception 'There is no round open right now.'; end if;
  if (select count(*) from public.quiz_players where round_id = r.id) >= 80 then
    raise exception 'This round is full.';
  end if;
  begin
    insert into public.quiz_players (round_id, name) values (r.id, nm) returning id into pid;
  exception when unique_violation then
    raise exception 'Someone already has that name. Add your initial.';
  end;
  return pid;
end $$;
revoke all on function public.quiz_join(text) from public;
grant execute on function public.quiz_join(text) to anon, authenticated;

-- Her questions, in her own order: a photo and four names each.
-- Nothing says which name is right.
create function public.quiz_questions(p_player uuid)
returns table (seq int, photo text, options text[])
language sql stable security definer set search_path = '' as $$
  select o.seq::int, o.photo,
    (select array_agg(x.name order by md5(p_player::text || o.id::text || x.id::text || 'order'))
     from (
       select pp.id, pp.name from public.quiz_people pp where pp.id = o.id
       union all
       (select pp.id, pp.name from public.quiz_people pp where pp.id <> o.id
        order by md5(p_player::text || o.id::text || pp.id::text) limit 3)
     ) x)
  from (
    select pe.id, pe.photo, row_number() over (order by md5(p_player::text || pe.id::text)) as seq
    from public.quiz_people pe
  ) o
  where exists (
    select 1 from public.quiz_players pl
    join public.quiz_rounds ro on ro.id = pl.round_id
    where pl.id = p_player and now() < ro.closes_at)
  order by o.seq
$$;
revoke all on function public.quiz_questions(uuid) from public;
grant execute on function public.quiz_questions(uuid) to anon, authenticated;

-- Send one answer. The first answer to a question counts. Time is the
-- database's clock, so a slow phone cannot cheat the clock.
create function public.quiz_answer(p_player uuid, p_seq int, p_choice text) returns json
language plpgsql security definer set search_path = '' as $$
declare
  r public.quiz_rounds;
  pid int;
  nm text;
  ok boolean;
  prev public.quiz_answers;
begin
  select ro.* into r
  from public.quiz_players pl join public.quiz_rounds ro on ro.id = pl.round_id
  where pl.id = p_player;
  if not found then raise exception 'This player is not in a round.'; end if;
  if now() >= r.closes_at then raise exception 'Time is up.'; end if;

  select o.id, o.name into pid, nm
  from (
    select pe.id, pe.name, row_number() over (order by md5(p_player::text || pe.id::text)) as seq
    from public.quiz_people pe
  ) o
  where o.seq = p_seq;
  if not found then raise exception 'There is no such question.'; end if;

  select * into prev from public.quiz_answers where player_id = p_player and seq = p_seq;
  if found then
    return json_build_object('correct', prev.correct, 'answer', case when prev.correct then null else nm end);
  end if;

  ok := (nm = p_choice);
  insert into public.quiz_answers (player_id, seq, person_id, choice, correct)
  values (p_player, p_seq, pid, left(coalesce(p_choice, ''), 60), ok);
  return json_build_object('correct', ok, 'answer', case when ok then null else nm end);
end $$;
revoke all on function public.quiz_answer(uuid, int, text) from public;
grant execute on function public.quiz_answer(uuid, int, text) to anon, authenticated;

-- ── The coach only ───────────────────────────────────────────────────────────
create function public.quiz_open(p_seconds int default 90) returns json
language plpgsql security definer set search_path = '' as $$
declare r public.quiz_rounds;
begin
  if not public.is_coach() then raise exception 'Only the coach can start the quiz.'; end if;
  if exists (select 1 from public.quiz_rounds where closes_at > now()) then
    raise exception 'A round is already open.';
  end if;
  insert into public.quiz_rounds (closes_at, seconds)
  values (now() + make_interval(secs => greatest(30, least(600, coalesce(p_seconds, 90)))),
          greatest(30, least(600, coalesce(p_seconds, 90))))
  returning * into r;
  return json_build_object('round_id', r.id, 'opened_at', r.opened_at, 'closes_at', r.closes_at, 'seconds', r.seconds);
end $$;
revoke all on function public.quiz_open(int) from public, anon;
grant execute on function public.quiz_open(int) to authenticated;

create function public.quiz_stop() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_coach() then raise exception 'Only the coach can stop the quiz.'; end if;
  update public.quiz_rounds set closes_at = greatest(now(), opened_at + interval '1 second') where closes_at > now();
end $$;
revoke all on function public.quiz_stop() from public, anon;
grant execute on function public.quiz_stop() to authenticated;

-- Everyone's score, and every answer she gave. Latest round unless one is named.
create function public.quiz_results(p_round uuid default null) returns json
language plpgsql stable security definer set search_path = '' as $$
declare r public.quiz_rounds;
begin
  if not public.is_coach() then raise exception 'Only the coach can see the results.'; end if;
  if p_round is null then
    select * into r from public.quiz_rounds order by opened_at desc limit 1;
  else
    select * into r from public.quiz_rounds where id = p_round;
  end if;
  if not found then return json_build_object('round_id', null, 'players', '[]'::json); end if;
  return json_build_object(
    'round_id', r.id, 'opened_at', r.opened_at, 'closes_at', r.closes_at, 'seconds', r.seconds,
    'open', r.closes_at > now(),
    'players', coalesce((
      select json_agg(t.j order by t.score desc, t.finished_at asc nulls last)
      from (
        select b.score, b.finished_at,
          json_build_object(
            'name', b.name, 'score', b.score, 'answered', b.answered,
            'finished_secs', round(extract(epoch from (b.finished_at - r.opened_at))::numeric, 1),
            'answers', coalesce((
              select json_agg(json_build_object('seq', a.seq, 'who', pe.name, 'choice', a.choice, 'correct', a.correct)
                              order by a.seq)
              from public.quiz_answers a join public.quiz_people pe on pe.id = a.person_id
              where a.player_id = b.player_id), '[]'::json)
          ) as j
        from public.quiz_board(r.id) b
      ) t), '[]'::json));
end $$;
revoke all on function public.quiz_results(uuid) from public, anon;
grant execute on function public.quiz_results(uuid) to authenticated;
