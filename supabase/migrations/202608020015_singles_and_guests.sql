-- 1) 게임 방식: 코트 선택 후 단식/복식을 고를 수 있다. (기본 복식)
--    단식은 1:1(2명), 복식은 2:2(4명)로 시작 인원이 달라진다.
-- 2) 게스트: 회원이 아닌 게스트를 게임에 추가해 시작할 수 있다.
--    게스트는 순환·전적 집계에 포함되지 않는다.

-- 1. 스키마 -------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type where typname = 'game_type') then
    create type public.game_type as enum ('singles', 'doubles');
  end if;
end;
$$;

alter table public.game_slots
  add column if not exists game_type public.game_type not null
    default 'doubles';

alter table public.game_slot_players
  alter column member_id drop not null;

alter table public.game_slot_players
  add column if not exists guest_name text;

alter table public.game_slot_players
  drop constraint if exists game_slot_players_guest_name_check;
alter table public.game_slot_players
  add constraint game_slot_players_guest_name_check
  check (guest_name is null or char_length(guest_name) between 1 and 20);

alter table public.game_slot_players
  drop constraint if exists game_slot_players_identity_check;
alter table public.game_slot_players
  add constraint game_slot_players_identity_check
  check (member_id is not null or guest_name is not null);

create or replace function public.game_slot_capacity(p_type public.game_type)
returns integer
language sql
immutable
as $$
  select case when p_type = 'singles' then 2 else 4 end;
$$;

-- 2. 게임 생성: 단식/복식 선택 --------------------------------------------------

drop function if exists public.create_game_slot(text);

create or replace function public.create_game_slot(
  p_court_name text,
  p_game_type public.game_type default 'doubles'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  actor_club_id uuid;
  target_day_id uuid;
  new_slot_id uuid;
begin
  select club_id
  into actor_club_id
  from public.members
  where id = actor_id
    and is_active;

  if actor_club_id is null then
    raise exception '활성 회원만 게임 슬롯을 만들 수 있습니다.';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      actor_club_id::text || ':game:' || public.seoul_today()::text,
      0
    )
  );

  insert into public.game_days (club_id, game_date)
  values (actor_club_id, public.seoul_today())
  on conflict (club_id, game_date) do nothing;

  select id
  into target_day_id
  from public.game_days
  where club_id = actor_club_id
    and game_date = public.seoul_today()
  for update;

  perform public.assert_court_available(target_day_id, p_court_name);

  insert into public.game_slots (
    club_id,
    game_day_id,
    court_name,
    game_type,
    source,
    created_by
  )
  values (
    actor_club_id,
    target_day_id,
    trim(p_court_name),
    coalesce(p_game_type, 'doubles'),
    'manual',
    actor_id
  )
  returning id into new_slot_id;

  return new_slot_id;
end;
$$;

revoke all on function public.create_game_slot(text, public.game_type)
from public;
grant execute on function public.create_game_slot(text, public.game_type)
to authenticated;

-- 3. 게임 참여: 방식별 정원 -----------------------------------------------------

create or replace function public.join_game_slot(p_slot_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  actor_club_id uuid;
  target_day_id uuid;
  slot_status public.game_slot_status;
  slot_type public.game_type;
  slot_capacity integer;
  cycle_number integer;
  attendance_record public.game_attendances%rowtype;
  player_count integer;
  selected_team public.team_type;
  new_player_id uuid;
begin
  select club_id
  into actor_club_id
  from public.members
  where id = actor_id
    and is_active;

  if actor_club_id is null then
    raise exception '활성 회원만 게임에 참여할 수 있습니다.';
  end if;

  select game_day_id, status, game_type
  into target_day_id, slot_status, slot_type
  from public.game_slots
  where id = p_slot_id
    and club_id = actor_club_id;

  if target_day_id is null or slot_status <> 'open' then
    raise exception '현재 참여할 수 없는 슬롯입니다.';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      actor_club_id::text || ':game:' || public.seoul_today()::text,
      0
    )
  );

  select status
  into slot_status
  from public.game_slots
  where id = p_slot_id
    and game_day_id = target_day_id
  for update;

  if slot_status <> 'open' then
    raise exception '현재 참여할 수 없는 슬롯입니다.';
  end if;

  select current_cycle
  into cycle_number
  from public.game_days
  where id = target_day_id
    and game_date = public.seoul_today()
  for update;

  if cycle_number is null then
    raise exception '오늘 생성된 슬롯이 아닙니다.';
  end if;

  select *
  into attendance_record
  from public.game_attendances
  where game_day_id = target_day_id
    and member_id = actor_id
  for update;

  if attendance_record.id is null or not attendance_record.active then
    raise exception '먼저 오늘 게임 참석을 눌러 주세요.';
  end if;

  if exists (
    select 1
    from public.game_slot_players player
    join public.game_slots slot on slot.id = player.slot_id
    where slot.game_day_id = target_day_id
      and slot.status in ('open', 'playing')
      and player.member_id = actor_id
  ) then
    raise exception '이미 다른 열린 게임에 참여 중입니다.';
  end if;

  slot_capacity := public.game_slot_capacity(slot_type);

  select count(*)::integer
  into player_count
  from public.game_slot_players
  where slot_id = p_slot_id;

  if player_count >= slot_capacity then
    raise exception '게임 인원이 이미 가득 찼습니다.';
  end if;

  selected_team := case
    when (
      select count(*)
      from public.game_slot_players
      where slot_id = p_slot_id
        and team = 'A'
    ) < slot_capacity / 2 then 'A'::public.team_type
    else 'B'::public.team_type
  end;

  insert into public.game_slot_players (
    club_id,
    slot_id,
    member_id,
    team,
    joined_cycle,
    skill_score
  )
  values (
    actor_club_id,
    p_slot_id,
    actor_id,
    selected_team,
    cycle_number,
    coalesce(public.member_skill_score(actor_id), 0)
  )
  returning id into new_player_id;

  -- 순환 credit 은 게임 완료 시점에만 준다.
  return new_player_id;
end;
$$;

-- 4. 게스트 추가 / 제거 ---------------------------------------------------------

create or replace function public.add_guest_player(
  p_slot_id uuid,
  p_guest_name text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  actor_club_id uuid;
  target_day_id uuid;
  slot_status public.game_slot_status;
  slot_type public.game_type;
  slot_capacity integer;
  cycle_number integer;
  player_count integer;
  selected_team public.team_type;
  new_player_id uuid;
begin
  select club_id
  into actor_club_id
  from public.members
  where id = actor_id
    and is_active;

  if actor_club_id is null then
    raise exception '활성 회원만 게스트를 추가할 수 있습니다.';
  end if;

  if char_length(trim(p_guest_name)) not between 1 and 20 then
    raise exception '게스트 이름은 1자 이상 20자 이하로 입력해 주세요.';
  end if;

  select game_day_id, status, game_type
  into target_day_id, slot_status, slot_type
  from public.game_slots
  where id = p_slot_id
    and club_id = actor_club_id;

  if target_day_id is null or slot_status <> 'open' then
    raise exception '모집 중인 게임에만 게스트를 추가할 수 있습니다.';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      actor_club_id::text || ':game:' || public.seoul_today()::text,
      0
    )
  );

  select status
  into slot_status
  from public.game_slots
  where id = p_slot_id
  for update;

  if slot_status <> 'open' then
    raise exception '모집 중인 게임에만 게스트를 추가할 수 있습니다.';
  end if;

  select current_cycle
  into cycle_number
  from public.game_days
  where id = target_day_id
  for update;

  slot_capacity := public.game_slot_capacity(slot_type);

  select count(*)::integer
  into player_count
  from public.game_slot_players
  where slot_id = p_slot_id;

  if player_count >= slot_capacity then
    raise exception '게임 인원이 이미 가득 찼습니다.';
  end if;

  selected_team := case
    when (
      select count(*)
      from public.game_slot_players
      where slot_id = p_slot_id
        and team = 'A'
    ) < slot_capacity / 2 then 'A'::public.team_type
    else 'B'::public.team_type
  end;

  insert into public.game_slot_players (
    club_id,
    slot_id,
    member_id,
    guest_name,
    team,
    joined_cycle,
    skill_score
  )
  values (
    actor_club_id,
    p_slot_id,
    null,
    trim(p_guest_name),
    selected_team,
    coalesce(cycle_number, 1),
    0
  )
  returning id into new_player_id;

  return new_player_id;
end;
$$;

create or replace function public.remove_guest_player(
  p_slot_id uuid,
  p_player_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_club_id uuid := public.current_club_id();
begin
  if actor_club_id is null then
    raise exception '활성 회원만 게스트를 제외할 수 있습니다.';
  end if;

  perform 1
  from public.game_slots
  where id = p_slot_id
    and club_id = actor_club_id
    and status = 'open'
  for update;

  if not found then
    raise exception '모집 중인 게임에서만 게스트를 제외할 수 있습니다.';
  end if;

  delete from public.game_slot_players
  where id = p_player_id
    and slot_id = p_slot_id
    and member_id is null;

  if not found then
    raise exception '제외할 게스트를 찾을 수 없습니다.';
  end if;
end;
$$;

revoke all on function public.add_guest_player(uuid, text) from public;
revoke all on function public.remove_guest_player(uuid, uuid) from public;
grant execute on function public.add_guest_player(uuid, text)
to authenticated;
grant execute on function public.remove_guest_player(uuid, uuid)
to authenticated;

-- 5. 게임 시작·완료·팀 변경: 방식별 인원 검증 ------------------------------------

create or replace function public.start_game_slot(p_slot_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_club_id uuid := public.current_club_id();
  target_day_id uuid;
  slot_type public.game_type;
  slot_capacity integer;
  total_players integer;
  team_a_players integer;
  team_b_players integer;
begin
  select game_day_id, game_type
  into target_day_id, slot_type
  from public.game_slots
  where id = p_slot_id
    and club_id = actor_club_id
    and status = 'open';

  if target_day_id is null then
    raise exception '시작할 수 있는 열린 슬롯이 아닙니다.';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      actor_club_id::text || ':game:' || public.seoul_today()::text,
      0
    )
  );

  perform 1
  from public.game_slots
  where id = p_slot_id
    and status = 'open'
  for update;

  if not found then
    raise exception '이미 시작되었거나 종료된 게임입니다.';
  end if;

  slot_capacity := public.game_slot_capacity(slot_type);

  select
    count(*)::integer,
    count(*) filter (where team = 'A')::integer,
    count(*) filter (where team = 'B')::integer
  into total_players, team_a_players, team_b_players
  from public.game_slot_players
  where slot_id = p_slot_id;

  if total_players <> slot_capacity
    or team_a_players <> slot_capacity / 2
    or team_b_players <> slot_capacity / 2 then
    raise exception
      '팀 구성이 완성되어야 게임을 시작할 수 있습니다. (단식 1:1, 복식 2:2)';
  end if;

  update public.game_slots
  set
    status = 'playing',
    started_at = clock_timestamp()
  where id = p_slot_id
    and status = 'open';
end;
$$;

create or replace function public.complete_game_slot(
  p_slot_id uuid,
  p_team_a_score integer,
  p_team_b_score integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  actor_club_id uuid := public.current_club_id();
  target_day_id uuid;
  previous_status public.game_slot_status;
  slot_type public.game_type;
  winner public.team_type;
  cycle_number integer;
begin
  if p_team_a_score not between 0 and 99
    or p_team_b_score not between 0 and 99 then
    raise exception '점수는 0점 이상 99점 이하로 입력해 주세요.';
  end if;

  if p_team_a_score = p_team_b_score then
    raise exception '동점이 아닌 최종 점수를 입력해 주세요.';
  end if;

  select game_day_id, status, game_type
  into target_day_id, previous_status, slot_type
  from public.game_slots
  where id = p_slot_id
    and club_id = actor_club_id
    and status in ('playing', 'completed');

  if target_day_id is null then
    raise exception '점수를 입력하거나 수정할 수 있는 게임이 아닙니다.';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      actor_club_id::text || ':game:' || public.seoul_today()::text,
      0
    )
  );

  select status
  into previous_status
  from public.game_slots
  where id = p_slot_id
    and status in ('playing', 'completed')
  for update;

  if previous_status is null then
    raise exception '점수를 입력하거나 수정할 수 있는 게임이 아닙니다.';
  end if;

  if (
    select count(*)
    from public.game_slot_players
    where slot_id = p_slot_id
  ) <> public.game_slot_capacity(slot_type) then
    raise exception '모든 참가자 정보가 필요합니다.';
  end if;

  winner := case
    when p_team_a_score > p_team_b_score then 'A'::public.team_type
    else 'B'::public.team_type
  end;

  insert into public.game_results (
    club_id,
    slot_id,
    team_a_score,
    team_b_score,
    winner_team,
    recorded_by
  )
  values (
    actor_club_id,
    p_slot_id,
    p_team_a_score,
    p_team_b_score,
    winner,
    actor_id
  )
  on conflict (slot_id)
  do update set
    team_a_score = excluded.team_a_score,
    team_b_score = excluded.team_b_score,
    winner_team = excluded.winner_team,
    recorded_by = excluded.recorded_by,
    updated_at = now();

  if previous_status = 'playing' then
    select current_cycle
    into cycle_number
    from public.game_days
    where id = target_day_id
    for update;

    update public.game_slots
    set
      status = 'completed',
      completed_at = clock_timestamp()
    where id = p_slot_id;

    -- 게임을 끝까지 마친 회원에게만 순환 credit 을 준다. (게스트 제외)
    update public.game_attendances attendance
    set
      games_played = attendance.games_played + 1,
      last_game_at = clock_timestamp(),
      last_joined_cycle = greatest(
        attendance.last_joined_cycle,
        coalesce(cycle_number, attendance.last_joined_cycle)
      )
    where attendance.game_day_id = target_day_id
      and attendance.member_id in (
        select member_id
        from public.game_slot_players
        where slot_id = p_slot_id
          and member_id is not null
      );

    perform public.advance_game_cycle_if_complete(target_day_id);
  end if;
end;
$$;

create or replace function public.change_game_team(
  p_slot_id uuid,
  p_member_id uuid,
  p_team public.team_type
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_club_id uuid := public.current_club_id();
  target_day_id uuid;
  slot_type public.game_type;
  team_capacity integer;
begin
  select game_day_id, game_type
  into target_day_id, slot_type
  from public.game_slots
  where id = p_slot_id
    and club_id = actor_club_id
    and status = 'open';

  if target_day_id is null then
    raise exception '열린 슬롯의 팀만 변경할 수 있습니다.';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      actor_club_id::text || ':game:' || public.seoul_today()::text,
      0
    )
  );

  perform 1
  from public.game_slots
  where id = p_slot_id
    and status = 'open'
  for update;

  if not found then
    raise exception '이미 시작되었거나 종료된 게임입니다.';
  end if;

  team_capacity := public.game_slot_capacity(slot_type) / 2;

  if (
    select count(*)
    from public.game_slot_players
    where slot_id = p_slot_id
      and team = p_team
      and (member_id is null or member_id <> p_member_id)
  ) >= team_capacity then
    raise exception '한 팀에 배치할 수 있는 인원을 초과했습니다.';
  end if;

  update public.game_slot_players
  set team = p_team
  where slot_id = p_slot_id
    and member_id = p_member_id
    and club_id = actor_club_id;

  if not found then
    raise exception '변경할 참가자를 찾을 수 없습니다.';
  end if;
end;
$$;

-- 6. 앱 스냅샷 v7: 게임 방식(gameType)과 게스트 참가자 표시 ------------------

create or replace function public.get_app_snapshot()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  actor_member public.members%rowtype;
  club_name text;
  today_seoul date := public.seoul_today();
  target_lesson_session_id uuid;
  lesson_queue jsonb := '[]'::jsonb;
  my_lesson jsonb;
  monthly_lessons integer := 0;
  monthly_lesson_dates jsonb := '[]'::jsonb;
  can_join_lesson boolean := false;
  target_game_day_id uuid;
  cycle_number integer := 1;
  game_attendees jsonb := '[]'::jsonb;
  game_slots jsonb := '[]'::jsonb;
  my_attendance_active boolean := false;
  my_can_join boolean := false;
  total_games integer := 0;
  total_wins integer := 0;
  total_losses integer := 0;
  community_members jsonb := '[]'::jsonb;
  community_notices jsonb := '[]'::jsonb;
  community_matching jsonb := '[]'::jsonb;
  community_team_rankings jsonb := '[]'::jsonb;
begin
  select *
  into actor_member
  from public.members
  where id = actor_id
    and is_active;

  if actor_member.id is null then
    raise exception '활성 회원 정보를 찾을 수 없습니다.';
  end if;

  select name
  into club_name
  from public.clubs
  where id = actor_member.club_id;

  select id
  into target_lesson_session_id
  from public.lesson_sessions
  where club_id = actor_member.club_id
    and session_date = today_seoul;

  if target_lesson_session_id is not null then
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', booking.id,
          'memberId', booking.member_id,
          'nickname', member.nickname,
          'position', booking.position,
          'joinedAt', booking.joined_at,
          'estimatedStartAt', booking.estimated_start_at,
          'status', booking.status,
          'isMine', booking.member_id = actor_id
        )
        order by booking.position
      ),
      '[]'::jsonb
    )
    into lesson_queue
    from public.lesson_bookings booking
    join public.members member on member.id = booking.member_id
    where booking.session_id = target_lesson_session_id
      and booking.status = 'waiting';

    select jsonb_build_object(
      'id', booking.id,
      'memberId', booking.member_id,
      'nickname', actor_member.nickname,
      'position', booking.position,
      'joinedAt', booking.joined_at,
      'estimatedStartAt', booking.estimated_start_at,
      'status', booking.status,
      'isMine', true
    )
    into my_lesson
    from public.lesson_bookings booking
    where booking.session_id = target_lesson_session_id
      and booking.member_id = actor_id
      and booking.status = 'waiting';
  end if;

  select count(*)::integer
  into monthly_lessons
  from public.lesson_bookings booking
  join public.lesson_sessions session on session.id = booking.session_id
  where booking.member_id = actor_id
    and booking.status in ('waiting', 'completed')
    and session.session_date >=
      date_trunc('month', timezone('Asia/Seoul', now()))::date
    and session.session_date <
      (
        date_trunc('month', timezone('Asia/Seoul', now()))
        + interval '1 month'
      )::date;


  select coalesce(
    jsonb_agg(
      to_char(session.session_date, 'YYYY-MM-DD')
      order by session.session_date
    ),
    '[]'::jsonb
  )
  into monthly_lesson_dates
  from public.lesson_bookings booking
  join public.lesson_sessions session on session.id = booking.session_id
  where booking.member_id = actor_id
    and booking.status in ('waiting', 'completed')
    and session.session_date >=
      date_trunc('month', timezone('Asia/Seoul', now()))::date
    and session.session_date <
      (
        date_trunc('month', timezone('Asia/Seoul', now()))
        + interval '1 month'
      )::date;

  can_join_lesson :=
    timezone('Asia/Seoul', now())::time >= time '17:00'
    and my_lesson is null;

  select id, current_cycle
  into target_game_day_id, cycle_number
  from public.game_days
  where club_id = actor_member.club_id
    and game_date = today_seoul;

  if target_game_day_id is not null then
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', attendance.id,
          'memberId', attendance.member_id,
          'nickname', member.nickname,
          'avatarUrl', member.avatar_url,
          'gender', member.gender,
          'experienceMonths', member.experience_months,
          'lessonCount',
            member.prior_lesson_count
            + (
              select count(*)::integer
              from public.lesson_bookings lesson
              where lesson.member_id = member.id
                and lesson.status in ('waiting', 'completed')
            ),
          'gamesPlayed', attendance.games_played,
          'lastJoinedCycle', attendance.last_joined_cycle,
          'lastGameAt', attendance.last_game_at,
          'active', attendance.active,
          'canJoin',
            attendance.active
            and attendance.last_joined_cycle < cycle_number
            and not exists (
              select 1
              from public.game_slot_players occupied_player
              join public.game_slots occupied_slot
                on occupied_slot.id = occupied_player.slot_id
              where occupied_player.member_id = attendance.member_id
                and occupied_slot.game_day_id = target_game_day_id
                and occupied_slot.status in ('open', 'playing')
            )
        )
        order by
          attendance.active desc,
          attendance.games_played,
          attendance.last_game_at nulls first,
          member.nickname
      ),
      '[]'::jsonb
    )
    into game_attendees
    from public.game_attendances attendance
    join public.members member on member.id = attendance.member_id
    where attendance.game_day_id = target_game_day_id;

    select
      coalesce(attendance.active, false),
      coalesce(
        attendance.active
        and attendance.last_joined_cycle < cycle_number
        and not exists (
          select 1
          from public.game_slot_players occupied_player
          join public.game_slots occupied_slot
            on occupied_slot.id = occupied_player.slot_id
          where occupied_player.member_id = actor_id
            and occupied_slot.game_day_id = target_game_day_id
            and occupied_slot.status in ('open', 'playing')
        ),
        false
      )
    into my_attendance_active, my_can_join
    from public.game_attendances attendance
    where attendance.game_day_id = target_game_day_id
      and attendance.member_id = actor_id;

    select coalesce(
      jsonb_agg(slot_data order by sort_order, created_at desc),
      '[]'::jsonb
    )
    into game_slots
    from (
      select
        case slot.status
          when 'open' then 1
          when 'playing' then 2
          else 3
        end as sort_order,
        slot.created_at,
        jsonb_build_object(
          'id', slot.id,
          'courtName', slot.court_name,
          'gameType', slot.game_type,
          'status', slot.status,
          'source', slot.source,
          'createdAt', slot.created_at,
          'startedAt', slot.started_at,
          'players', coalesce(
            (
              select jsonb_agg(
                jsonb_build_object(
                  'id', player.id,
                  'memberId', player.member_id,
                  'nickname', coalesce(member.nickname, player.guest_name),
                  'isGuest', player.member_id is null,
                  'team', player.team,
                  'joinedCycle', player.joined_cycle,
                  'skillScore', player.skill_score
                )
                order by player.team, player.joined_at
              )
              from public.game_slot_players player
              left join public.members member
                on member.id = player.member_id
              where player.slot_id = slot.id
            ),
            '[]'::jsonb
          ),
          'result', case
            when result.id is null then null
            else jsonb_build_object(
              'teamAScore', result.team_a_score,
              'teamBScore', result.team_b_score,
              'winnerTeam', result.winner_team
            )
          end
        ) as slot_data
      from public.game_slots slot
      left join public.game_results result on result.slot_id = slot.id
      where slot.game_day_id = target_game_day_id
        and slot.status <> 'cancelled'
    ) ordered_slots;
  end if;

  select
    count(*)::integer,
    count(*) filter (where player.team = result.winner_team)::integer
  into total_games, total_wins
  from public.game_slot_players player
  join public.game_slots slot on slot.id = player.slot_id
  join public.game_results result on result.slot_id = slot.id
  where player.member_id = actor_id
    and slot.status = 'completed';

  total_losses := total_games - total_wins;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'memberId', member.id,
        'nickname', member.nickname,
        'avatarUrl', member.avatar_url,
        'role', member.role,
        'gender', member.gender,
        'experienceMonths', member.experience_months,
        'lessonCount',
          member.prior_lesson_count
          + (
            select count(*)::integer
            from public.lesson_bookings lesson
            where lesson.member_id = member.id
              and lesson.status in ('waiting', 'completed')
          ),
        'joinedAt', member.created_at,
        'games', coalesce(stats.games, 0),
        'wins', coalesce(stats.wins, 0),
        'losses', coalesce(stats.games, 0) - coalesce(stats.wins, 0)
      )
      order by member.nickname
    ),
    '[]'::jsonb
  )
  into community_members
  from public.members member
  left join lateral (
    select
      count(*)::integer as games,
      count(*) filter (where player.team = result.winner_team)::integer as wins
    from public.game_slot_players player
    join public.game_slots slot
      on slot.id = player.slot_id and slot.status = 'completed'
    join public.game_results result on result.slot_id = slot.id
    where player.member_id = member.id
  ) stats on true
  where member.club_id = actor_member.club_id
    and member.is_active;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'memberAId', pair.member_a_id,
        'memberANickname', member_a.nickname,
        'memberAAvatarUrl', member_a.avatar_url,
        'memberBId', pair.member_b_id,
        'memberBNickname', member_b.nickname,
        'memberBAvatarUrl', member_b.avatar_url,
        'games', pair.games,
        'wins', pair.wins,
        'losses', pair.games - pair.wins
      )
      order by
        pair.wins desc,
        (pair.wins::numeric / pair.games) desc,
        pair.games desc,
        member_a.nickname
    ),
    '[]'::jsonb
  )
  into community_team_rankings
  from (
    select
      least(first_player.member_id, second_player.member_id) as member_a_id,
      greatest(first_player.member_id, second_player.member_id) as member_b_id,
      count(*)::integer as games,
      count(*) filter (
        where first_player.team = result.winner_team
      )::integer as wins
    from public.game_slot_players first_player
    join public.game_slot_players second_player
      on second_player.slot_id = first_player.slot_id
      and second_player.team = first_player.team
      and first_player.member_id < second_player.member_id
    join public.game_slots slot
      on slot.id = first_player.slot_id
      and slot.club_id = actor_member.club_id
      and slot.status = 'completed'
    join public.game_results result on result.slot_id = slot.id
    group by 1, 2
    order by
      count(*) filter (where first_player.team = result.winner_team) desc,
      (
        count(*) filter (where first_player.team = result.winner_team)::numeric
        / count(*)
      ) desc,
      count(*) desc
    limit 30
  ) pair
  join public.members member_a on member_a.id = pair.member_a_id
  join public.members member_b on member_b.id = pair.member_b_id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', post.id,
        'category', post.category,
        'title', post.title,
        'content', post.content,
        'authorId', post.author_id,
        'authorNickname', author.nickname,
        'authorAvatarUrl', author.avatar_url,
        'createdAt', post.created_at,
        'eventDate', post.event_date,
        'eventTime', to_char(post.event_time, 'HH24:MI'),
        'location', post.location,
        'capacity', post.capacity,
        'participants', '[]'::jsonb,
        'myJoined', false
      )
      order by post.created_at desc
    ),
    '[]'::jsonb
  )
  into community_notices
  from (
    select *
    from public.posts
    where club_id = actor_member.club_id
      and category = 'notice'
    order by created_at desc
    limit 20
  ) post
  join public.members author on author.id = post.author_id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', post.id,
        'category', post.category,
        'title', post.title,
        'content', post.content,
        'authorId', post.author_id,
        'authorNickname', author.nickname,
        'authorAvatarUrl', author.avatar_url,
        'createdAt', post.created_at,
        'eventDate', post.event_date,
        'eventTime', to_char(post.event_time, 'HH24:MI'),
        'location', post.location,
        'capacity', post.capacity,
        'participants', coalesce(
          (
            select jsonb_agg(
              jsonb_build_object(
                'memberId', participant.member_id,
                'nickname', participant_member.nickname,
                'avatarUrl', participant_member.avatar_url
              )
              order by participant.created_at
            )
            from public.post_participants participant
            join public.members participant_member
              on participant_member.id = participant.member_id
            where participant.post_id = post.id
          ),
          '[]'::jsonb
        ),
        'myJoined', exists (
          select 1
          from public.post_participants mine
          where mine.post_id = post.id
            and mine.member_id = actor_id
        )
      )
      order by post.created_at desc
    ),
    '[]'::jsonb
  )
  into community_matching
  from (
    select *
    from public.posts
    where club_id = actor_member.club_id
      and category = 'matching'
    order by created_at desc
    limit 30
  ) post
  join public.members author on author.id = post.author_id;

  return jsonb_build_object(
    'member', jsonb_build_object(
      'id', actor_member.id,
      'clubId', actor_member.club_id,
      'clubName', club_name,
      'nickname', actor_member.nickname,
      'avatarUrl', actor_member.avatar_url,
      'role', actor_member.role,
      'gender', actor_member.gender,
      'experienceMonths', actor_member.experience_months,
      'priorLessonCount', actor_member.prior_lesson_count,
      'joinedAt', actor_member.created_at
    ),
    'lesson', jsonb_build_object(
      'sessionId', target_lesson_session_id,
      'sessionDate', today_seoul,
      'canJoin', can_join_lesson,
      'queue', lesson_queue,
      'myBooking', my_lesson,
      'monthlyCount', monthly_lessons,
      'monthlyDates', monthly_lesson_dates
    ),
    'game', jsonb_build_object(
      'dayId', target_game_day_id,
      'dayDate', today_seoul,
      'currentCycle', coalesce(cycle_number, 1),
      'myAttendanceActive', my_attendance_active,
      'myCanJoin', my_can_join,
      'attendees', game_attendees,
      'slots', game_slots
    ),
    'community', jsonb_build_object(
      'members', community_members,
      'notices', community_notices,
      'matching', community_matching,
      'teamRankings', community_team_rankings
    ),
    'records', jsonb_build_object(
      'wins', total_wins,
      'losses', total_losses,
      'games', total_games,
      'lessonsThisMonth', monthly_lessons
    )
  );
end;
$$;

revoke all on function public.get_app_snapshot() from public;
grant execute on function public.get_app_snapshot() to authenticated;
