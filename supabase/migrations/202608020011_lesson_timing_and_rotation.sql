-- 1) 레슨 예상 시간: 진행 중인 레슨의 남은 시간을 기준으로 연쇄 계산하고,
--    예정 시간이 지난 레슨은 자동으로 완료 처리한다.
-- 2) 레슨 알림: 15분 전 / 5분 전 / 시간 변경 3종으로 확장한다.
-- 3) 순환: 게임을 완료해야만 순환 횟수가 올라간다. (참여·취소로는 변화 없음)
-- 4) 스냅샷: 팀(파트너 조합) 랭킹 집계를 추가한다.

-- 1. notification_logs 확장 ---------------------------------------------------

alter table public.notification_logs
  add column if not exists kind text not null default 'before15',
  add column if not exists send_after timestamptz;

alter table public.notification_logs
  drop constraint if exists notification_logs_kind_check;

alter table public.notification_logs
  add constraint notification_logs_kind_check
  check (kind in ('before15', 'before5', 'changed'));

update public.notification_logs
set send_after = scheduled_for - interval '15 minutes'
where send_after is null;

alter table public.notification_logs
  alter column send_after set not null;

alter table public.notification_logs
  drop constraint if exists
    notification_logs_booking_id_subscription_id_scheduled_for_key;

alter table public.notification_logs
  drop constraint if exists notification_logs_dedupe_key;

alter table public.notification_logs
  add constraint notification_logs_dedupe_key
  unique (booking_id, subscription_id, kind, scheduled_for);

drop index if exists public.notification_logs_pending_idx;
create index notification_logs_pending_idx
  on public.notification_logs (status, send_after)
  where status = 'pending';

-- 2. 레슨 대기열 재계산 --------------------------------------------------------
-- 규칙:
--   * 예정 시간 + 15분이 지난 예약은 완료 처리한다.
--   * 첫 대기자가 레슨 진행 중이면(예정 시각이 지났지만 15분 이내)
--     그 시작 시각을 유지하고, 뒤 대기자는 앞사람 종료 시각부터 15분씩 잇는다.
--   * 대기자가 줄면 뒤 사람의 시간이 앞으로 당겨지되, 현재 시각보다
--     이르게 배정하지는 않는다.
--   * 시작 전 예약의 예상 시각이 1분 이상 바뀌면 '시간 변경' 알림을 예약한다.

create or replace function public.resequence_lesson_queue(target_session_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  session_row public.lesson_sessions%rowtype;
  booking_row public.lesson_bookings%rowtype;
  now_ts timestamptz := now();
  slot_length interval;
  chain_end timestamptz;
  new_start timestamptz;
  next_position integer := 0;
begin
  select *
  into session_row
  from public.lesson_sessions
  where id = target_session_id;

  if session_row.id is null then
    return;
  end if;

  slot_length := make_interval(mins => session_row.duration_minutes::integer);

  -- 예정 시간이 이미 끝난 레슨은 완료 처리해 대기열에서 내려보낸다.
  update public.lesson_bookings
  set status = 'completed'
  where session_id = target_session_id
    and status = 'waiting'
    and estimated_start_at + slot_length <= now_ts;

  chain_end := session_row.starts_at;

  for booking_row in
    select *
    from public.lesson_bookings
    where session_id = target_session_id
      and status = 'waiting'
    order by joined_at, id
  loop
    next_position := next_position + 1;
    new_start := greatest(chain_end, booking_row.joined_at);

    if new_start < now_ts then
      if booking_row.estimated_start_at <= now_ts
        and now_ts < booking_row.estimated_start_at + slot_length then
        -- 진행 중인 레슨은 원래 시작 시각을 유지한다.
        new_start := booking_row.estimated_start_at;
      else
        new_start := now_ts;
      end if;
    end if;

    if booking_row.position is distinct from next_position
      or booking_row.estimated_start_at is distinct from new_start then
      update public.lesson_bookings
      set
        position = next_position,
        estimated_start_at = new_start
      where id = booking_row.id;
    end if;

    -- 시작 전 예약의 예상 시각이 1분 이상 바뀌면 변경 알림을 예약한다.
    -- 방금 만들어진 예약(첫 배정)은 제외한다.
    if new_start > now_ts
      and abs(extract(epoch from (new_start - booking_row.estimated_start_at))) >= 60
      and booking_row.created_at < now_ts - interval '1 minute' then
      delete from public.notification_logs
      where booking_id = booking_row.id
        and kind = 'changed'
        and status = 'pending';

      insert into public.notification_logs (
        club_id,
        member_id,
        booking_id,
        subscription_id,
        kind,
        scheduled_for,
        send_after,
        status
      )
      select
        booking_row.club_id,
        booking_row.member_id,
        booking_row.id,
        subscription.id,
        'changed',
        new_start,
        now_ts,
        'pending'
      from public.push_subscriptions subscription
      where subscription.member_id = booking_row.member_id
      on conflict (booking_id, subscription_id, kind, scheduled_for) do nothing;

      -- 시간이 바뀌었으므로 이전 시각 기준 리마인더는 지운다.
      delete from public.notification_logs
      where booking_id = booking_row.id
        and kind in ('before15', 'before5')
        and status = 'pending'
        and scheduled_for <> new_start;
    end if;

    chain_end := new_start + slot_length;
  end loop;
end;
$$;

revoke all on function public.resequence_lesson_queue(uuid)
from public, anon, authenticated;

-- 오늘 열린 모든 레슨 대기열을 최신 상태로 맞춘다. (알림 크론에서 호출)
create or replace function public.sync_today_lesson_queues()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  session_row record;
begin
  for session_row in
    select id, club_id
    from public.lesson_sessions
    where session_date = public.seoul_today()
      and status = 'open'
  loop
    perform pg_advisory_xact_lock(
      hashtextextended(
        session_row.club_id::text || ':lesson:' || public.seoul_today()::text,
        0
      )
    );
    perform public.resequence_lesson_queue(session_row.id);
  end loop;
end;
$$;

revoke all on function public.sync_today_lesson_queues()
from public, anon, authenticated;
grant execute on function public.sync_today_lesson_queues() to service_role;

-- 3. 알림 발급·클레임: 15분 전 / 5분 전 / 시간 변경 -----------------------------

create or replace function public.claim_due_lesson_notifications(
  p_limit integer default 100
)
returns table (
  notification_id uuid,
  endpoint text,
  p256dh text,
  auth_key text,
  title text,
  body text,
  target_url text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  -- 대기열을 먼저 최신 상태로 맞춘다. (자동 완료·시간 재계산·변경 알림 예약)
  perform public.sync_today_lesson_queues();

  update public.notification_logs
  set
    status = 'pending',
    error_message = '이전 발송 작업이 중단되어 재시도합니다.'
  where status = 'processing'
    and updated_at < now() - interval '5 minutes';

  -- 상태가 바뀐 예약(취소·완료)이나 시각이 달라진 리마인더는 정리한다.
  delete from public.notification_logs log
  using public.lesson_bookings booking
  where booking.id = log.booking_id
    and log.status = 'pending'
    and (
      booking.status <> 'waiting'
      or (
        log.kind in ('before15', 'before5')
        and log.scheduled_for <> booking.estimated_start_at
      )
    );

  -- 15분 전 / 5분 전 리마인더를 만든다.
  insert into public.notification_logs (
    club_id,
    member_id,
    booking_id,
    subscription_id,
    kind,
    scheduled_for,
    send_after,
    status
  )
  select
    booking.club_id,
    booking.member_id,
    booking.id,
    subscription.id,
    reminder.kind,
    booking.estimated_start_at,
    booking.estimated_start_at - reminder.lead_time,
    'pending'
  from public.lesson_bookings booking
  join public.lesson_sessions session on session.id = booking.session_id
  join public.push_subscriptions subscription
    on subscription.member_id = booking.member_id
  cross join (
    values
      ('before15', interval '15 minutes'),
      ('before5', interval '5 minutes')
  ) as reminder(kind, lead_time)
  where booking.status = 'waiting'
    and session.session_date = public.seoul_today()
    and booking.estimated_start_at > now()
    and booking.estimated_start_at - reminder.lead_time
      > now() - interval '3 minutes'
  on conflict (booking_id, subscription_id, kind, scheduled_for) do nothing;

  return query
  with due as (
    select log.id
    from public.notification_logs log
    where log.status = 'pending'
      and log.send_after <= now()
    order by log.send_after
    for update skip locked
    limit greatest(1, least(p_limit, 500))
  ),
  claimed as (
    update public.notification_logs log
    set status = 'processing'
    from due
    where log.id = due.id
    returning log.*
  )
  select
    claimed.id,
    subscription.endpoint,
    subscription.p256dh,
    subscription.auth_key,
    case claimed.kind
      when 'before5' then '곧 레슨이 시작됩니다'
      when 'changed' then '레슨 예상 시간 변경'
      else '레슨 15분 전입니다'
    end::text,
    (
      member.nickname
      || case claimed.kind
        when 'before5' then
          '님, '
          || to_char(claimed.scheduled_for at time zone 'Asia/Seoul', 'HH24:MI')
          || ' 레슨이 곧 시작됩니다. 준비해 주세요.'
        when 'changed' then
          '님, 레슨 예상 시각이 '
          || to_char(claimed.scheduled_for at time zone 'Asia/Seoul', 'HH24:MI')
          || '(으)로 변경되었습니다.'
        else
          '님, '
          || to_char(claimed.scheduled_for at time zone 'Asia/Seoul', 'HH24:MI')
          || '에 레슨이 시작될 예정입니다.'
      end
    )::text,
    '/lesson'::text
  from claimed
  join public.push_subscriptions subscription
    on subscription.id = claimed.subscription_id
  join public.members member on member.id = claimed.member_id;
end;
$$;

revoke all on function public.claim_due_lesson_notifications(integer)
from public, anon, authenticated;
grant execute on function public.claim_due_lesson_notifications(integer)
to service_role;

-- 4. 순환: 게임 완료 기준 ------------------------------------------------------
-- last_joined_cycle 의미가 '이번 순환에서 게임을 완료했는가'로 바뀐다.
-- 참여(join)·자동 배치 생성·취소·나가기는 순환 상태를 바꾸지 않고,
-- 게임 완료(complete) 시점에만 credit 을 준다.

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

  select game_day_id, status
  into target_day_id, slot_status
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

  select count(*)::integer
  into player_count
  from public.game_slot_players
  where slot_id = p_slot_id;

  if player_count >= 4 then
    raise exception '게임 슬롯이 이미 가득 찼습니다.';
  end if;

  selected_team := case
    when (
      select count(*)
      from public.game_slot_players
      where slot_id = p_slot_id
        and team = 'A'
    ) < 2 then 'A'::public.team_type
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

create or replace function public.leave_game_slot(p_slot_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  actor_club_id uuid;
  target_day_id uuid;
  removed_player_id uuid;
begin
  select club_id
  into actor_club_id
  from public.members
  where id = actor_id
    and is_active;

  select game_day_id
  into target_day_id
  from public.game_slots
  where id = p_slot_id
    and club_id = actor_club_id
    and status = 'open';

  if target_day_id is null then
    raise exception '열린 슬롯에서만 나갈 수 있습니다.';
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
    raise exception '게임이 시작되어 슬롯에서 나갈 수 없습니다.';
  end if;

  delete from public.game_slot_players
  where slot_id = p_slot_id
    and member_id = actor_id
  returning id into removed_player_id;

  if removed_player_id is null then
    raise exception '참여 중인 슬롯이 아닙니다.';
  end if;

  -- 완료 전에는 순환 credit 이 없으므로 되돌릴 것도 없다.
end;
$$;

create or replace function public.cancel_game_slot(p_slot_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_club_id uuid := public.current_club_id();
  target_day_id uuid;
  slot_status public.game_slot_status;
begin
  if actor_club_id is null then
    raise exception '활성 회원만 게임을 취소할 수 있습니다.';
  end if;

  select game_day_id, status
  into target_day_id, slot_status
  from public.game_slots
  where id = p_slot_id
    and club_id = actor_club_id;

  if target_day_id is null then
    raise exception '취소할 게임을 찾을 수 없습니다.';
  end if;

  if slot_status not in ('open', 'playing') then
    raise exception '이미 종료되었거나 취소된 게임입니다.';
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
    and status in ('open', 'playing')
  for update;

  if not found then
    raise exception '이미 종료되었거나 취소된 게임입니다.';
  end if;

  -- 완료 전 취소는 순환에 반영되지 않으므로 상태만 바꾼다.
  update public.game_slots
  set status = 'cancelled'
  where id = p_slot_id;
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

  select game_day_id, status
  into target_day_id, previous_status
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
  ) <> 4 then
    raise exception '4명의 참가자 정보가 필요합니다.';
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

    -- 게임을 끝까지 마쳐야 순환 credit 을 준다.
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
      );

    perform public.advance_game_cycle_if_complete(target_day_id);
  end if;
end;
$$;

create or replace function public.confirm_auto_arrangement(
  p_court_name text,
  p_players jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  actor_club_id uuid := public.current_club_id();
  target_day_id uuid;
  cycle_number integer;
  new_slot_id uuid;
begin
  if actor_club_id is null then
    raise exception '활성 회원만 자동 배치를 확정할 수 있습니다.';
  end if;

  if jsonb_typeof(p_players) <> 'array'
    or jsonb_array_length(p_players) <> 4 then
    raise exception '자동 배치에는 서로 다른 4명이 필요합니다.';
  end if;

  if (
    select count(distinct value ->> 'memberId')
    from jsonb_array_elements(p_players)
  ) <> 4 then
    raise exception '중복된 회원이 포함되어 있습니다.';
  end if;

  if (
    select count(*)
    from jsonb_array_elements(p_players)
    where value ->> 'team' = 'A'
  ) <> 2 or (
    select count(*)
    from jsonb_array_elements(p_players)
    where value ->> 'team' = 'B'
  ) <> 2 then
    raise exception 'A팀과 B팀에 각각 2명을 배치해 주세요.';
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

  select id, current_cycle
  into target_day_id, cycle_number
  from public.game_days
  where club_id = actor_club_id
    and game_date = public.seoul_today()
  for update;

  perform public.assert_court_available(target_day_id, p_court_name);

  if exists (
    with candidates as (
      select (value ->> 'memberId')::uuid as member_id
      from jsonb_array_elements(p_players)
    )
    select 1
    from candidates candidate
    left join public.game_attendances attendance
      on attendance.game_day_id = target_day_id
      and attendance.member_id = candidate.member_id
    left join public.members member
      on member.id = candidate.member_id
      and member.club_id = actor_club_id
      and member.is_active
    where member.id is null
      or attendance.id is null
      or not attendance.active
      or attendance.last_joined_cycle >= cycle_number
      or exists (
        select 1
        from public.game_slot_players player
        join public.game_slots slot on slot.id = player.slot_id
        where player.member_id = candidate.member_id
          and slot.game_day_id = target_day_id
          and slot.status in ('open', 'playing')
      )
  ) then
    raise exception '참여 상태가 변경되었습니다. 자동 배치를 다시 실행해 주세요.';
  end if;

  insert into public.game_slots (
    club_id,
    game_day_id,
    court_name,
    source,
    created_by
  )
  values (
    actor_club_id,
    target_day_id,
    trim(p_court_name),
    'auto',
    actor_id
  )
  returning id into new_slot_id;

  insert into public.game_slot_players (
    club_id,
    slot_id,
    member_id,
    team,
    joined_cycle,
    skill_score
  )
  select
    actor_club_id,
    new_slot_id,
    (value ->> 'memberId')::uuid,
    (value ->> 'team')::public.team_type,
    cycle_number,
    coalesce(
      public.member_skill_score((value ->> 'memberId')::uuid),
      0
    )
  from jsonb_array_elements(p_players);

  -- 순환 credit 은 게임 완료 시점에만 준다.
  return new_slot_id;
end;
$$;

-- 5. 앱 스냅샷 v3: 팀 랭킹 추가 -------------------------------------------------

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
                  'nickname', member.nickname,
                  'team', player.team,
                  'joinedCycle', player.joined_cycle,
                  'skillScore', player.skill_score
                )
                order by player.team, player.joined_at
              )
              from public.game_slot_players player
              join public.members member on member.id = player.member_id
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

  -- 같은 팀으로 뛴 2인 조합별 전적 (동호회 전체, 승수·승률 순 상위 30팀)
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
        'createdAt', post.created_at
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
        'createdAt', post.created_at
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
      'monthlyCount', monthly_lessons
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
