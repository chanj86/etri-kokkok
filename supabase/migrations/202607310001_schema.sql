create extension if not exists pgcrypto with schema extensions;

create type public.member_role as enum ('owner', 'member');
create type public.gender_type as enum ('male', 'female', 'unspecified');
create type public.lesson_booking_status as enum ('waiting', 'completed', 'cancelled');
create type public.lesson_session_status as enum ('open', 'closed');
create type public.game_slot_status as enum ('open', 'playing', 'completed', 'cancelled');
create type public.game_slot_source as enum ('manual', 'auto');
create type public.team_type as enum ('A', 'B');

create table public.clubs (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 80),
  code_normalized text not null unique
    check (code_normalized ~ '^[A-Z0-9_-]{3,24}$'),
  join_code_hash text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.members (
  id uuid primary key references auth.users(id) on delete cascade,
  club_id uuid not null references public.clubs(id) on delete cascade,
  nickname text not null check (char_length(nickname) between 2 and 20),
  nickname_normalized text not null,
  role public.member_role not null default 'member',
  gender public.gender_type not null default 'unspecified',
  experience_months integer not null default 0
    check (experience_months between 0 and 600),
  prior_lesson_count integer not null default 0
    check (prior_lesson_count between 0 and 9999),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (club_id, nickname_normalized)
);

comment on column public.members.gender is
  '자동 배치에서 선택적으로 혼복 균형에만 사용한다.';

create table public.member_credentials (
  member_id uuid primary key references public.members(id) on delete cascade,
  club_id uuid not null references public.clubs(id) on delete cascade,
  login_name_normalized text not null,
  auth_email text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (club_id, login_name_normalized)
);

create table public.login_attempts (
  identifier_hash text primary key,
  failed_count integer not null default 0,
  lock_until timestamptz,
  last_attempt_at timestamptz not null default now()
);

create table public.lesson_sessions (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  session_date date not null,
  starts_at timestamptz not null,
  duration_minutes smallint not null default 15
    check (duration_minutes = 15),
  status public.lesson_session_status not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (club_id, session_date)
);

create table public.lesson_bookings (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  session_id uuid not null references public.lesson_sessions(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete restrict,
  joined_at timestamptz not null default clock_timestamp(),
  position integer not null check (position > 0),
  estimated_start_at timestamptz not null,
  status public.lesson_booking_status not null default 'waiting',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index lesson_bookings_one_active_per_member
  on public.lesson_bookings (session_id, member_id)
  where status in ('waiting', 'completed');

create index lesson_bookings_queue_idx
  on public.lesson_bookings (session_id, status, joined_at);

create table public.game_days (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  game_date date not null,
  current_cycle integer not null default 1 check (current_cycle > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (club_id, game_date)
);

create table public.game_attendances (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  game_day_id uuid not null references public.game_days(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete restrict,
  active boolean not null default true,
  last_joined_cycle integer not null default 0 check (last_joined_cycle >= 0),
  games_played integer not null default 0 check (games_played >= 0),
  last_game_at timestamptz,
  joined_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (game_day_id, member_id)
);

create index game_attendances_rotation_idx
  on public.game_attendances
  (game_day_id, active, last_joined_cycle, games_played, last_game_at);

create table public.game_slots (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  game_day_id uuid not null references public.game_days(id) on delete cascade,
  court_name text not null check (char_length(court_name) between 1 and 30),
  status public.game_slot_status not null default 'open',
  source public.game_slot_source not null default 'manual',
  created_by uuid not null references public.members(id) on delete restrict,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index game_slots_day_status_idx
  on public.game_slots (game_day_id, status, created_at desc);

create table public.game_slot_players (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  slot_id uuid not null references public.game_slots(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete restrict,
  team public.team_type not null,
  joined_cycle integer not null check (joined_cycle > 0),
  skill_score numeric(7, 1) not null default 0 check (skill_score >= 0),
  joined_at timestamptz not null default clock_timestamp(),
  unique (slot_id, member_id)
);

create index game_slot_players_member_idx
  on public.game_slot_players (member_id, joined_at desc);

create table public.game_results (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  slot_id uuid not null unique references public.game_slots(id) on delete cascade,
  team_a_score smallint not null check (team_a_score between 0 and 99),
  team_b_score smallint not null check (team_b_score between 0 and 99),
  winner_team public.team_type not null,
  recorded_by uuid not null references public.members(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (team_a_score <> team_b_score),
  check (
    (winner_team = 'A' and team_a_score > team_b_score)
    or (winner_team = 'B' and team_b_score > team_a_score)
  )
);

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth_key text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.notification_logs (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  booking_id uuid not null references public.lesson_bookings(id) on delete cascade,
  subscription_id uuid not null
    references public.push_subscriptions(id) on delete cascade,
  scheduled_for timestamptz not null,
  sent_at timestamptz,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'sent', 'failed')),
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (booking_id, subscription_id, scheduled_for)
);

create index notification_logs_pending_idx
  on public.notification_logs (status, scheduled_for)
  where status = 'pending';

create table public.audit_logs (
  id bigint generated always as identity primary key,
  club_id uuid not null references public.clubs(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  table_name text not null,
  record_id text not null,
  action text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);

create index audit_logs_club_created_idx
  on public.audit_logs (club_id, created_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger clubs_set_updated_at
before update on public.clubs
for each row execute function public.set_updated_at();

create trigger members_set_updated_at
before update on public.members
for each row execute function public.set_updated_at();

create trigger member_credentials_set_updated_at
before update on public.member_credentials
for each row execute function public.set_updated_at();

create trigger lesson_sessions_set_updated_at
before update on public.lesson_sessions
for each row execute function public.set_updated_at();

create trigger lesson_bookings_set_updated_at
before update on public.lesson_bookings
for each row execute function public.set_updated_at();

create trigger game_days_set_updated_at
before update on public.game_days
for each row execute function public.set_updated_at();

create trigger game_attendances_set_updated_at
before update on public.game_attendances
for each row execute function public.set_updated_at();

create trigger game_slots_set_updated_at
before update on public.game_slots
for each row execute function public.set_updated_at();

create trigger game_results_set_updated_at
before update on public.game_results
for each row execute function public.set_updated_at();

create trigger push_subscriptions_set_updated_at
before update on public.push_subscriptions
for each row execute function public.set_updated_at();

create trigger notification_logs_set_updated_at
before update on public.notification_logs
for each row execute function public.set_updated_at();

create or replace function public.capture_audit_log()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  payload jsonb;
  target_club_id uuid;
  target_record_id text;
begin
  payload := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  target_club_id := (payload ->> 'club_id')::uuid;
  target_record_id := coalesce(payload ->> 'id', payload ->> 'slot_id', 'unknown');

  insert into public.audit_logs (
    club_id,
    actor_id,
    table_name,
    record_id,
    action,
    before_data,
    after_data
  )
  values (
    target_club_id,
    auth.uid(),
    tg_table_name,
    target_record_id,
    tg_op,
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger lesson_bookings_audit
after insert or update or delete on public.lesson_bookings
for each row execute function public.capture_audit_log();

create trigger game_slots_audit
after insert or update or delete on public.game_slots
for each row execute function public.capture_audit_log();

create trigger game_results_audit
after insert or update or delete on public.game_results
for each row execute function public.capture_audit_log();
