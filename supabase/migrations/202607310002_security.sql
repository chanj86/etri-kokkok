create or replace function public.seoul_today()
returns date
language sql
stable
set search_path = public
as $$
  select timezone('Asia/Seoul', now())::date;
$$;

create or replace function public.normalize_member_name(value text)
returns text
language sql
immutable
set search_path = public
as $$
  select lower(regexp_replace(trim(value), '\s+', ' ', 'g'));
$$;

create or replace function public.current_club_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select club_id
  from public.members
  where id = auth.uid()
    and is_active;
$$;

create or replace function public.is_active_member_of(target_club_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.members
    where id = auth.uid()
      and club_id = target_club_id
      and is_active
  );
$$;

create or replace function public.is_owner_of(target_club_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.members
    where id = auth.uid()
      and club_id = target_club_id
      and role = 'owner'
      and is_active
  );
$$;

create or replace function public.member_skill_score(target_member_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select round(
    (
      sqrt(greatest(m.experience_months, 0)::numeric) * 8
      + sqrt(
          greatest(
            m.prior_lesson_count
            + (
              select count(*)::integer
              from public.lesson_bookings lb
              where lb.member_id = m.id
                and lb.status in ('waiting', 'completed')
            ),
            0
          )::numeric
        ) * 5
    ),
    1
  )
  from public.members m
  where m.id = target_member_id;
$$;

alter table public.clubs enable row level security;
alter table public.members enable row level security;
alter table public.member_credentials enable row level security;
alter table public.login_attempts enable row level security;
alter table public.lesson_sessions enable row level security;
alter table public.lesson_bookings enable row level security;
alter table public.game_days enable row level security;
alter table public.game_attendances enable row level security;
alter table public.game_slots enable row level security;
alter table public.game_slot_players enable row level security;
alter table public.game_results enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.notification_logs enable row level security;
alter table public.audit_logs enable row level security;

create policy clubs_read_same_club
on public.clubs
for select
to authenticated
using (public.is_active_member_of(id));

create policy members_read_same_club
on public.members
for select
to authenticated
using (public.is_active_member_of(club_id));

create policy lesson_sessions_read_same_club
on public.lesson_sessions
for select
to authenticated
using (public.is_active_member_of(club_id));

create policy lesson_bookings_read_same_club
on public.lesson_bookings
for select
to authenticated
using (public.is_active_member_of(club_id));

create policy game_days_read_same_club
on public.game_days
for select
to authenticated
using (public.is_active_member_of(club_id));

create policy game_attendances_read_same_club
on public.game_attendances
for select
to authenticated
using (public.is_active_member_of(club_id));

create policy game_slots_read_same_club
on public.game_slots
for select
to authenticated
using (public.is_active_member_of(club_id));

create policy game_slot_players_read_same_club
on public.game_slot_players
for select
to authenticated
using (public.is_active_member_of(club_id));

create policy game_results_read_same_club
on public.game_results
for select
to authenticated
using (public.is_active_member_of(club_id));

create policy push_subscriptions_read_own
on public.push_subscriptions
for select
to authenticated
using (member_id = auth.uid());

create policy notification_logs_read_own
on public.notification_logs
for select
to authenticated
using (member_id = auth.uid());

create policy audit_logs_read_owner
on public.audit_logs
for select
to authenticated
using (public.is_owner_of(club_id));

revoke all on public.member_credentials from anon, authenticated;
revoke all on public.login_attempts from anon, authenticated;
revoke all on public.audit_logs from anon;

grant select on public.clubs, public.members, public.lesson_sessions,
  public.lesson_bookings, public.game_days, public.game_attendances,
  public.game_slots, public.game_slot_players, public.game_results
to authenticated;

grant select on public.push_subscriptions, public.notification_logs
to authenticated;

grant select on public.audit_logs to authenticated;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'lesson_bookings',
    'game_attendances',
    'game_slots',
    'game_slot_players',
    'game_results'
  ]
  loop
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = table_name
    ) then
      execute format(
        'alter publication supabase_realtime add table public.%I',
        table_name
      );
    end if;
  end loop;
end;
$$;
