-- Royal Victory H.C. Dames 1 team app: tables.
-- Applies to an empty Supabase project. Row level security is in the next file.

create extension if not exists pgcrypto with schema extensions;

-- People who can sign in: the coach and the players.
create table public.members (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(btrim(name)) between 1 and 60),
  role       text not null check (role in ('coach', 'player')),
  user_id    uuid unique references auth.users (id) on delete set null,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index members_name_role_idx on public.members (lower(name), role) where active;

-- One-time codes. Only a hash is stored, the code itself is shown once.
create table public.invites (
  id         uuid primary key default gen_random_uuid(),
  member_id  uuid not null references public.members (id) on delete cascade,
  code_hash  text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '14 days',
  used_at    timestamptz
);
create unique index invites_one_open_idx on public.invites (member_id) where used_at is null;

-- Passkeys (WebAuthn). Written and read by the edge function only.
create table public.passkeys (
  credential_id text primary key,
  member_id     uuid not null references public.members (id) on delete cascade,
  public_key    text not null,
  counter       bigint not null default 0,
  transports    text[],
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz
);
create index passkeys_member_idx on public.passkeys (member_id);

create table public.auth_challenges (
  id         uuid primary key default gen_random_uuid(),
  challenge  text not null,
  purpose    text not null check (purpose in ('register', 'login')),
  member_id  uuid references public.members (id) on delete cascade,
  invite_id  uuid references public.invites (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.auth_attempts (
  id   bigint generated always as identity primary key,
  ip   text not null,
  kind text not null,
  at   timestamptz not null default now()
);
create index auth_attempts_idx on public.auth_attempts (kind, ip, at);

-- A player's own read of a match.
create table public.reflections (
  id            uuid primary key default gen_random_uuid(),
  player_id     uuid not null references public.members (id) on delete cascade,
  match_date    date not null,
  opponent      text check (length(opponent) <= 80),
  rating        int check (rating between 1 and 5),
  went_well     text check (length(went_well) <= 4000),
  work_on       text check (length(work_on) <= 4000),
  match_thoughts text check (length(match_thoughts) <= 4000),
  submitted_at  timestamptz not null default now(),
  unique (player_id, match_date)
);

-- One good thing about an assigned teammate. Only the coach reads these.
create table public.teammate_praise (
  id            uuid primary key default gen_random_uuid(),
  reflection_id uuid not null references public.reflections (id) on delete cascade,
  from_id       uuid not null references public.members (id) on delete cascade,
  about_id      uuid not null references public.members (id) on delete cascade,
  match_date    date not null,
  note          text not null check (length(btrim(note)) between 1 and 2000),
  created_at    timestamptz not null default now(),
  unique (from_id, match_date),
  check (from_id <> about_id)
);

-- Anonymous words for the coach. No link to any player, and only a date.
create table public.coach_notes (
  id                uuid primary key default gen_random_uuid(),
  match_date        date not null,
  nothing_to_change boolean not null default false,
  body              text check (length(body) <= 4000)
);

-- The coach's feedback: to one player or to the whole team.
create table public.feedback (
  id         uuid primary key default gen_random_uuid(),
  audience   text not null check (audience in ('player', 'team')),
  player_id  uuid references public.members (id) on delete cascade,
  topic      text not null check (topic in ('match', 'training', 'general')),
  ref_date   date,
  title      text check (length(title) <= 120),
  body       text not null check (length(btrim(body)) between 1 and 8000),
  created_at timestamptz not null default now(),
  created_by uuid references public.members (id) on delete set null,
  check ((audience = 'player') = (player_id is not null))
);
create index feedback_player_idx on public.feedback (player_id, created_at desc);

create table public.feedback_reads (
  member_id   uuid not null references public.members (id) on delete cascade,
  feedback_id uuid not null references public.feedback (id) on delete cascade,
  read_at     timestamptz not null default now(),
  primary key (member_id, feedback_id)
);

-- Slides, PDFs and schedules. One team, so no team column.
create table public.files (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null check (kind in ('tactics', 'schedule', 'briefing', 'other')),
  title        text not null check (length(btrim(title)) between 1 and 160),
  storage_path text not null unique,
  mime         text not null,
  size_bytes   bigint,
  match_date   date,
  uploaded_at  timestamptz not null default now(),
  published_at timestamptz
);
create index files_kind_idx on public.files (kind, match_date desc);
