create or replace function public.advance_game_cycle_if_complete(
  target_game_day_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  cycle_number integer;
begin
  select current_cycle
  into cycle_number
  from public.game_days
  where id = target_game_day_id
  for update;

  if cycle_number is null then
    return false;
  end if;

  if exists (
    select 1
    from public.game_attendances
    where game_day_id = target_game_day_id
      and active
  ) and not exists (
    select 1
    from public.game_attendances
    where game_day_id = target_game_day_id
      and active
      and last_joined_cycle < cycle_number
  ) then
    update public.game_days
    set current_cycle = cycle_number + 1
    where id = target_game_day_id;
    return true;
  end if;

  return false;
end;
$$;

revoke all on function public.advance_game_cycle_if_complete(uuid)
from public, anon, authenticated;

create or replace function public.set_game_attendance(p_active boolean)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  actor_club_id uuid;
  target_day_id uuid;
  cycle_number integer;
  attendance_id uuid;
begin
  select club_id
  into actor_club_id
  from public.members
  where id = actor_id
    and is_active;

  if actor_club_id is null then
    raise exception '활성 회원만 게임에 참석할 수 있습니다.';
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

  if p_active then
    insert into public.game_attendances (
      club_id,
      game_day_id,
      member_id,
      active,
      last_joined_cycle
    )
    values (
      actor_club_id,
      target_day_id,
      actor_id,
      true,
      greatest(cycle_number - 1, 0)
    )
    on conflict (game_day_id, member_id)
    do update set
      active = true,
      last_joined_cycle = least(
        public.game_attendances.last_joined_cycle,
        greatest(cycle_number - 1, 0)
      ),
      updated_at = now()
    returning id into attendance_id;
  else
    if exists (
      select 1
      from public.game_slot_players player
      join public.game_slots slot on slot.id = player.slot_id
      where slot.game_day_id = target_day_id
        and slot.status in ('open', 'playing')
        and player.member_id = actor_id
    ) then
      raise exception '참여 중인 슬롯을 먼저 종료하거나 나가 주세요.';
    end if;

    update public.game_attendances
    set active = false
    where game_day_id = target_day_id
      and member_id = actor_id
    returning id into attendance_id;

    if attendance_id is null then
      raise exception '오늘 게임 참석 기록이 없습니다.';
    end if;

    perform public.advance_game_cycle_if_complete(target_day_id);
  end if;

  return attendance_id;
end;
$$;

create or replace function public.create_game_slot(p_court_name text)
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

  if char_length(trim(p_court_name)) not between 1 and 30 then
    raise exception '코트 이름은 1자 이상 30자 이하로 입력해 주세요.';
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
    'manual',
    actor_id
  )
  returning id into new_slot_id;

  return new_slot_id;
end;
$$;

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

  if attendance_record.last_joined_cycle >= cycle_number then
    raise exception '다른 참석자들의 순환이 끝날 때까지 기다려 주세요.';
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

  update public.game_attendances
  set last_joined_cycle = cycle_number
  where id = attendance_record.id;

  perform public.advance_game_cycle_if_complete(target_day_id);
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
  cycle_number integer;
  player_cycle integer;
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

  select current_cycle
  into cycle_number
  from public.game_days
  where id = target_day_id
  for update;

  delete from public.game_slot_players
  where slot_id = p_slot_id
    and member_id = actor_id
  returning joined_cycle into player_cycle;

  if player_cycle is null then
    raise exception '참여 중인 슬롯이 아닙니다.';
  end if;

  update public.game_attendances
  set last_joined_cycle = least(
    last_joined_cycle,
    greatest(cycle_number - 1, 0)
  )
  where game_day_id = target_day_id
    and member_id = actor_id;
end;
$$;

create or replace function public.start_game_slot(p_slot_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_club_id uuid := public.current_club_id();
  target_day_id uuid;
  total_players integer;
  team_a_players integer;
  team_b_players integer;
begin
  select game_day_id
  into target_day_id
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

  select
    count(*)::integer,
    count(*) filter (where team = 'A')::integer,
    count(*) filter (where team = 'B')::integer
  into total_players, team_a_players, team_b_players
  from public.game_slot_players
  where slot_id = p_slot_id;

  if total_players <> 4 or team_a_players <> 2 or team_b_players <> 2 then
    raise exception 'A팀과 B팀에 각각 2명이 있어야 게임을 시작할 수 있습니다.';
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
  winner public.team_type;
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
    update public.game_slots
    set
      status = 'completed',
      completed_at = clock_timestamp()
    where id = p_slot_id;

    update public.game_attendances attendance
    set
      games_played = attendance.games_played + 1,
      last_game_at = clock_timestamp()
    where attendance.game_day_id = target_day_id
      and attendance.member_id in (
        select member_id
        from public.game_slot_players
        where slot_id = p_slot_id
      );
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
begin
  select game_day_id
  into target_day_id
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

  if (
    select count(*)
    from public.game_slot_players
    where slot_id = p_slot_id
      and team = p_team
      and member_id <> p_member_id
  ) >= 2 then
    raise exception '한 팀에는 최대 2명까지 배치할 수 있습니다.';
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

  if char_length(trim(p_court_name)) not between 1 and 30 then
    raise exception '코트 이름은 1자 이상 30자 이하로 입력해 주세요.';
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

  update public.game_attendances
  set last_joined_cycle = cycle_number
  where game_day_id = target_day_id
    and member_id in (
      select (value ->> 'memberId')::uuid
      from jsonb_array_elements(p_players)
    );

  perform public.advance_game_cycle_if_complete(target_day_id);
  return new_slot_id;
end;
$$;

revoke all on function public.set_game_attendance(boolean) from public;
revoke all on function public.create_game_slot(text) from public;
revoke all on function public.join_game_slot(uuid) from public;
revoke all on function public.leave_game_slot(uuid) from public;
revoke all on function public.start_game_slot(uuid) from public;
revoke all on function public.complete_game_slot(uuid, integer, integer)
from public;
revoke all on function public.change_game_team(
  uuid,
  uuid,
  public.team_type
) from public;
revoke all on function public.confirm_auto_arrangement(text, jsonb)
from public;

grant execute on function public.set_game_attendance(boolean)
to authenticated;
grant execute on function public.create_game_slot(text)
to authenticated;
grant execute on function public.join_game_slot(uuid)
to authenticated;
grant execute on function public.leave_game_slot(uuid)
to authenticated;
grant execute on function public.start_game_slot(uuid)
to authenticated;
grant execute on function public.complete_game_slot(uuid, integer, integer)
to authenticated;
grant execute on function public.change_game_team(
  uuid,
  uuid,
  public.team_type
) to authenticated;
grant execute on function public.confirm_auto_arrangement(text, jsonb)
to authenticated;
