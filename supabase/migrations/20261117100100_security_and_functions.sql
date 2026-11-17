-- Row level security, helper functions and the functions the app calls.
--
-- The rule: players read only their own reflections and feedback, plus
-- team-wide feedback and published files. Every write a player makes goes
-- through a function that takes her identity from the session, never from an
-- argument. Tables used for sign-in are closed to the app completely.

-- ── Lock down by default ─────────────────────────────────────────────────────
alter table public.members          enable row level security;
alter table public.invites          enable row level security;
alter table public.passkeys         enable row level security;
alter table public.auth_challenges  enable row level security;
alter table public.auth_attempts    enable row level security;
alter table public.reflections      enable row level security;
alter table public.teammate_praise  enable row level security;
alter table public.coach_notes      enable row level security;
alter table public.feedback         enable row level security;
alter table public.feedback_reads   enable row level security;
alter table public.files            enable row level security;

revoke all on public.invites, public.passkeys, public.auth_challenges, public.auth_attempts
  from anon, authenticated;
revoke all on public.members, public.reflections, public.teammate_praise,
              public.coach_notes, public.feedback, public.feedback_reads, public.files
  from anon;
-- Authenticated people read through policies. Writes to people, reflections,
-- praise, notes and reads are only through the functions below.
revoke insert, update, delete, truncate on public.members, public.reflections,
  public.teammate_praise, public.coach_notes, public.feedback_reads from authenticated;

-- ── Who is asking ────────────────────────────────────────────────────────────
create function public.me() returns uuid
language sql stable security definer set search_path = '' as $$
  select id from public.members where user_id = auth.uid() and active
$$;

create function public.is_coach() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.members
    where user_id = auth.uid() and active and role = 'coach')
$$;

revoke all on function public.me(), public.is_coach() from public, anon;
grant execute on function public.me(), public.is_coach() to authenticated;

-- ── Policies ─────────────────────────────────────────────────────────────────
create policy members_read on public.members for select to authenticated
  using (public.is_coach() or (user_id = auth.uid() and active));

create policy reflections_read on public.reflections for select to authenticated
  using (public.is_coach() or player_id = public.me());

create policy praise_read on public.teammate_praise for select to authenticated
  using (public.is_coach());

create policy coach_notes_read on public.coach_notes for select to authenticated
  using (public.is_coach());

create policy feedback_read on public.feedback for select to authenticated
  using (
    public.is_coach()
    or (public.me() is not null
        and (audience = 'team' or player_id = public.me())));
create policy feedback_coach_insert on public.feedback for insert to authenticated
  with check (public.is_coach());
create policy feedback_coach_update on public.feedback for update to authenticated
  using (public.is_coach()) with check (public.is_coach());
create policy feedback_coach_delete on public.feedback for delete to authenticated
  using (public.is_coach());

create policy reads_read on public.feedback_reads for select to authenticated
  using (public.is_coach() or member_id = public.me());

create policy files_read on public.files for select to authenticated
  using (public.is_coach() or (public.me() is not null and published_at is not null));
create policy files_coach_insert on public.files for insert to authenticated
  with check (public.is_coach());
create policy files_coach_update on public.files for update to authenticated
  using (public.is_coach()) with check (public.is_coach());
create policy files_coach_delete on public.files for delete to authenticated
  using (public.is_coach());

-- ── Functions the app calls ──────────────────────────────────────────────────

-- Keeps the free project awake. Reveals nothing.
create function public.ping() returns int
language sql stable security definer set search_path = '' as $$ select 1 $$;
revoke all on function public.ping() from public;
grant execute on function public.ping() to anon, authenticated;

-- Names of the active players, for choosing a teammate. Not for the coach's use
-- only: every signed-in member needs it. Ids and names, nothing else.
create function public.squad() returns table (id uuid, name text)
language sql stable security definer set search_path = '' as $$
  select m.id, m.name from public.members m
  where m.role = 'player' and m.active and public.me() is not null
  order by m.name
$$;
revoke all on function public.squad() from public, anon;
grant execute on function public.squad() to authenticated;

-- A player sends her post-match review. Her identity comes from the session.
create function public.submit_reflection(
  p_match_date     date,
  p_opponent       text,
  p_rating         int,
  p_went_well      text,
  p_work_on        text,
  p_match_thoughts text default null,
  p_mate_id        uuid default null,
  p_mate_note      text default null,
  p_coach_nothing  boolean default false,
  p_coach_body     text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_me       uuid := public.me();
  v_id       uuid;
  v_inserted boolean;
  v_body     text := nullif(btrim(coalesce(p_coach_body, '')), '');
begin
  if v_me is null
     or not exists (select 1 from public.members where id = v_me and role = 'player') then
    raise exception 'Only a player can send a match review.';
  end if;
  if p_match_date is null or p_match_date > current_date + 1 then
    raise exception 'Pick the date of the match.';
  end if;
  if p_rating is null or p_rating not between 1 and 5 then
    raise exception 'Give your own game a score from 1 to 5.';
  end if;
  if nullif(btrim(coalesce(p_went_well, '')), '') is null then
    raise exception 'Add one thing that went well.';
  end if;
  if nullif(btrim(coalesce(p_work_on, '')), '') is null then
    raise exception 'Add one thing you want to work on.';
  end if;

  insert into public.reflections
    (player_id, match_date, opponent, rating, went_well, work_on, match_thoughts)
  values
    (v_me, p_match_date, nullif(btrim(coalesce(p_opponent, '')), ''), p_rating,
     btrim(p_went_well), btrim(p_work_on),
     nullif(btrim(coalesce(p_match_thoughts, '')), ''))
  on conflict (player_id, match_date) do update
    set opponent       = excluded.opponent,
        rating         = excluded.rating,
        went_well      = excluded.went_well,
        work_on        = excluded.work_on,
        match_thoughts = excluded.match_thoughts,
        submitted_at   = now()
  returning id, (xmax = 0) into v_id, v_inserted;

  if p_mate_id is not null and nullif(btrim(coalesce(p_mate_note, '')), '') is not null then
    if p_mate_id = v_me then
      raise exception 'You cannot praise yourself.';
    end if;
    if not exists (select 1 from public.members
                   where id = p_mate_id and role = 'player' and active) then
      raise exception 'That teammate is not in the squad.';
    end if;
    insert into public.teammate_praise (reflection_id, from_id, about_id, match_date, note)
    values (v_id, v_me, p_mate_id, p_match_date, btrim(p_mate_note))
    on conflict (from_id, match_date) do update
      set about_id = excluded.about_id, note = excluded.note,
          reflection_id = excluded.reflection_id;
  end if;

  -- The anonymous note is stored only on the first send for that match, so a
  -- resend does not duplicate it. It carries a date and nothing else.
  if v_inserted and (p_coach_nothing or v_body is not null) then
    insert into public.coach_notes (match_date, nothing_to_change, body)
    values (p_match_date, coalesce(p_coach_nothing, false),
            case when p_coach_nothing then null else v_body end);
  end if;

  return v_id;
end;
$$;
revoke all on function public.submit_reflection(date, text, int, text, text, text, uuid, text, boolean, text)
  from public, anon;
grant execute on function public.submit_reflection(date, text, int, text, text, text, uuid, text, boolean, text)
  to authenticated;

-- A player marks a piece of feedback as read.
create function public.mark_feedback_read(p_feedback_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := public.me();
begin
  if v_me is null then raise exception 'Not signed in.'; end if;
  if not exists (select 1 from public.feedback f
                 where f.id = p_feedback_id
                   and (f.audience = 'team' or f.player_id = v_me)) then
    raise exception 'That feedback is not yours.';
  end if;
  insert into public.feedback_reads (member_id, feedback_id)
  values (v_me, p_feedback_id) on conflict do nothing;
end;
$$;
revoke all on function public.mark_feedback_read(uuid) from public, anon;
grant execute on function public.mark_feedback_read(uuid) to authenticated;

-- ── Coach tools ──────────────────────────────────────────────────────────────

-- The squad as the coach sees it: who has a login, who has a code waiting.
create function public.coach_squad() returns table (
  id uuid, name text, role text, active boolean, has_login boolean,
  invite_expires_at timestamptz, reflections bigint, last_match date)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_coach() then raise exception 'Coach only.'; end if;
  return query
    select m.id, m.name, m.role, m.active,
           exists (select 1 from public.passkeys k where k.member_id = m.id),
           (select i.expires_at from public.invites i
             where i.member_id = m.id and i.used_at is null and i.expires_at > now()),
           (select count(*) from public.reflections r where r.player_id = m.id),
           (select max(r.match_date) from public.reflections r where r.player_id = m.id)
    from public.members m
    order by m.role, m.active desc, m.name;
end;
$$;
revoke all on function public.coach_squad() from public, anon;
grant execute on function public.coach_squad() to authenticated;

create function public.add_player(p_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not public.is_coach() then raise exception 'Coach only.'; end if;
  if length(btrim(coalesce(p_name, ''))) not between 1 and 60 then
    raise exception 'Give the player a name.';
  end if;
  insert into public.members (name, role) values (btrim(p_name), 'player') returning id into v_id;
  return v_id;
exception when unique_violation then
  raise exception 'A player with that name is already in the squad.';
end;
$$;
revoke all on function public.add_player(text) from public, anon;
grant execute on function public.add_player(text) to authenticated;

create function public.rename_member(p_id uuid, p_name text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_coach() then raise exception 'Coach only.'; end if;
  if length(btrim(coalesce(p_name, ''))) not between 1 and 60 then
    raise exception 'Give a name.';
  end if;
  update public.members set name = btrim(p_name) where id = p_id;
exception when unique_violation then
  raise exception 'A player with that name is already in the squad.';
end;
$$;
revoke all on function public.rename_member(uuid, text) from public, anon;
grant execute on function public.rename_member(uuid, text) to authenticated;

-- Stop or restore someone's access. The coach cannot lock herself out.
create function public.set_member_active(p_id uuid, p_active boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_coach() then raise exception 'Coach only.'; end if;
  if p_id = public.me() and not p_active then
    raise exception 'You cannot switch off your own access.';
  end if;
  update public.members set active = p_active where id = p_id;
  if not p_active then
    delete from public.invites where member_id = p_id and used_at is null;
  end if;
end;
$$;
revoke all on function public.set_member_active(uuid, boolean) from public, anon;
grant execute on function public.set_member_active(uuid, boolean) to authenticated;

-- A new one-time code for a member. Replaces any code still waiting. Works for
-- a first sign-in and for a new phone. The code is returned once.
create function public.issue_invite(p_member_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_code text := '';
  v_bytes bytea;
  v_i int;
  v_b int;
begin
  if not public.is_coach() then raise exception 'Coach only.'; end if;
  if not exists (select 1 from public.members where id = p_member_id and active) then
    raise exception 'That person is not in the squad.';
  end if;
  while length(v_code) < 10 loop
    v_bytes := extensions.gen_random_bytes(32);
    for v_i in 0 .. 31 loop
      v_b := get_byte(v_bytes, v_i);
      if v_b < 217 and length(v_code) < 10 then   -- 217 = 31 * 7, no modulo bias
        v_code := v_code || substr(v_alphabet, (v_b % 31) + 1, 1);
      end if;
    end loop;
  end loop;
  delete from public.invites where member_id = p_member_id and used_at is null;
  insert into public.invites (member_id, code_hash)
  values (p_member_id, encode(extensions.digest(v_code, 'sha256'), 'hex'));
  return substr(v_code, 1, 5) || '-' || substr(v_code, 6, 5);
end;
$$;
revoke all on function public.issue_invite(uuid) from public, anon;
grant execute on function public.issue_invite(uuid) to authenticated;
