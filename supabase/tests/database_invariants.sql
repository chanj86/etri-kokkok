begin;

insert into auth.users (id, email)
select
  ('00000000-0000-0000-0000-' || lpad(value::text, 12, '0'))::uuid,
  'member-' || value || '@test.invalid'
from generate_series(101, 107) as value;

insert into public.clubs (id, name, code_normalized, join_code_hash)
values
  (
    '00000000-0000-0000-0000-000000000001',
    '테스트 동호회',
    'TESTCLUB',
    'test-hash'
  ),
  (
    '00000000-0000-0000-0000-000000000002',
    '다른 동호회',
    'OTHERCLUB',
    'test-hash'
  );

insert into public.members (
  id,
  club_id,
  nickname,
  nickname_normalized,
  role,
  gender,
  experience_months,
  prior_lesson_count
)
select
  ('00000000-0000-0000-0000-' || lpad(value::text, 12, '0'))::uuid,
  '00000000-0000-0000-0000-000000000001',
  '회원' || (value - 100),
  '회원' || (value - 100),
  case when value = 101 then 'owner'::public.member_role
       else 'member'::public.member_role end,
  case when value % 2 = 0 then 'female'::public.gender_type
       else 'male'::public.gender_type end,
  (value - 100) * 6,
  value - 100
from generate_series(101, 106) as value;

insert into public.members (
  id,
  club_id,
  nickname,
  nickname_normalized
)
values (
  '00000000-0000-0000-0000-000000000107',
  '00000000-0000-0000-0000-000000000002',
  '타동호회',
  '타동호회'
);

insert into public.member_credentials (
  member_id,
  club_id,
  login_name_normalized,
  auth_email
)
select
  id,
  club_id,
  nickname_normalized,
  'credential-' || id || '@test.invalid'
from public.members;

do $$
declare
  first_slot uuid;
  second_slot uuid;
  auto_slot uuid;
  current_round integer;
  blocked boolean := false;
  user_id uuid;
begin
  for user_id in
    select
      ('00000000-0000-0000-0000-' || lpad(value::text, 12, '0'))::uuid
    from generate_series(101, 106) as value
  loop
    perform set_config('request.jwt.claim.sub', user_id::text, true);
    perform public.set_game_attendance(true);
  end loop;

  perform set_config(
    'request.jwt.claim.sub',
    '00000000-0000-0000-0000-000000000101',
    true
  );
  first_slot := public.create_game_slot('1번 코트');
  second_slot := public.create_game_slot('2번 코트');

  for user_id in
    select
      ('00000000-0000-0000-0000-' || lpad(value::text, 12, '0'))::uuid
    from generate_series(101, 104) as value
  loop
    perform set_config('request.jwt.claim.sub', user_id::text, true);
    perform public.join_game_slot(first_slot);
  end loop;

  select current_cycle
  into current_round
  from public.game_days
  where club_id = '00000000-0000-0000-0000-000000000001'
    and game_date = public.seoul_today();
  if current_round <> 1 then
    raise exception '미참여 회원이 있는데 순환이 먼저 증가했습니다.';
  end if;

  perform set_config(
    'request.jwt.claim.sub',
    '00000000-0000-0000-0000-000000000101',
    true
  );
  begin
    perform public.join_game_slot(second_slot);
  exception
    when others then
      blocked := true;
  end;
  if not blocked then
    raise exception '같은 순환의 중복 참여가 차단되지 않았습니다.';
  end if;

  for user_id in
    select
      ('00000000-0000-0000-0000-' || lpad(value::text, 12, '0'))::uuid
    from generate_series(105, 106) as value
  loop
    perform set_config('request.jwt.claim.sub', user_id::text, true);
    perform public.join_game_slot(second_slot);
  end loop;

  select current_cycle
  into current_round
  from public.game_days
  where club_id = '00000000-0000-0000-0000-000000000001'
    and game_date = public.seoul_today();
  if current_round <> 2 then
    raise exception '모든 회원 참여 후 다음 순환이 열리지 않았습니다.';
  end if;

  perform set_config(
    'request.jwt.claim.sub',
    '00000000-0000-0000-0000-000000000101',
    true
  );
  perform public.start_game_slot(first_slot);
  perform public.complete_game_slot(first_slot, 21, 17);

  if (
    select count(*)
    from public.game_attendances
    where game_day_id = (
      select id
      from public.game_days
      where club_id = '00000000-0000-0000-0000-000000000001'
        and game_date = public.seoul_today()
    )
      and member_id in (
        select member_id
        from public.game_slot_players
        where slot_id = first_slot
      )
      and games_played = 1
  ) <> 4 then
    raise exception '게임 완료 후 참가자 전적이 반영되지 않았습니다.';
  end if;

  perform public.complete_game_slot(first_slot, 16, 21);
  if (
    select count(*)
    from public.game_attendances
    where game_day_id = (
      select id
      from public.game_days
      where club_id = '00000000-0000-0000-0000-000000000001'
        and game_date = public.seoul_today()
    )
      and member_id in (
        select member_id
        from public.game_slot_players
        where slot_id = first_slot
      )
      and games_played = 1
  ) <> 4 then
    raise exception '점수 수정이 게임 횟수를 중복 증가시켰습니다.';
  end if;

  for user_id in
    select
      ('00000000-0000-0000-0000-' || lpad(value::text, 12, '0'))::uuid
    from generate_series(101, 102) as value
  loop
    perform set_config('request.jwt.claim.sub', user_id::text, true);
    perform public.join_game_slot(second_slot);
  end loop;

  if (
    select count(*)
    from public.game_slot_players
    where slot_id = second_slot
  ) <> 4 then
    raise exception '순환 경계에서 4인 슬롯이 채워지지 않았습니다.';
  end if;

  perform public.start_game_slot(second_slot);
  perform public.complete_game_slot(second_slot, 18, 21);

  auto_slot := public.confirm_auto_arrangement(
    '3번 코트',
    '[
      {"memberId":"00000000-0000-0000-0000-000000000103","team":"A"},
      {"memberId":"00000000-0000-0000-0000-000000000104","team":"B"},
      {"memberId":"00000000-0000-0000-0000-000000000105","team":"A"},
      {"memberId":"00000000-0000-0000-0000-000000000106","team":"B"}
    ]'::jsonb
  );

  if (
    select count(*)
    from public.game_slot_players
    where slot_id = auto_slot
  ) <> 4 then
    raise exception '자동 배치가 4명을 저장하지 못했습니다.';
  end if;

  select current_cycle
  into current_round
  from public.game_days
  where club_id = '00000000-0000-0000-0000-000000000001'
    and game_date = public.seoul_today();
  if current_round <> 3 then
    raise exception '두 번째 순환 완료 후 다음 순환이 열리지 않았습니다.';
  end if;

  if (
    public.get_my_partner_stats() -> 0 ->> 'memberId'
  )::uuid <> '00000000-0000-0000-0000-000000000101'
    or (
      public.get_my_partner_stats() -> 0 ->> 'games'
    )::integer <> 2
    or (
      public.get_my_partner_stats() -> 0 ->> 'wins'
    )::integer <> 1 then
    raise exception '파트너별 게임 수와 승리 횟수가 정확하지 않습니다.';
  end if;
end;
$$;

insert into public.lesson_sessions (
  id,
  club_id,
  session_date,
  starts_at
)
values (
  '10000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000001',
  public.seoul_today(),
  now() - interval '1 hour'
);

insert into public.lesson_bookings (
  club_id,
  session_id,
  member_id,
  joined_at,
  position,
  estimated_start_at
)
select
  '00000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  ('00000000-0000-0000-0000-' || lpad(value::text, 12, '0'))::uuid,
  now() - interval '10 minutes' + (value - 101) * interval '1 minute',
  value - 100,
  now()
from generate_series(101, 103) as value;

select public.resequence_lesson_queue(
  '10000000-0000-0000-0000-000000000001'
);

do $$
begin
  if (
    select max(estimated_start_at) - min(estimated_start_at)
    from public.lesson_bookings
    where session_id = '10000000-0000-0000-0000-000000000001'
      and status = 'waiting'
  ) <> interval '30 minutes' then
    raise exception '레슨 예상 시각이 15분 간격으로 배정되지 않았습니다.';
  end if;

  perform set_config(
    'request.jwt.claim.sub',
    '00000000-0000-0000-0000-000000000102',
    true
  );
  perform public.delay_lesson();

  if (
    select position
    from public.lesson_bookings
    where member_id = '00000000-0000-0000-0000-000000000102'
      and session_id = '10000000-0000-0000-0000-000000000001'
  ) <> 3 then
    raise exception '레슨 미루기가 대기열 끝으로 이동하지 않았습니다.';
  end if;

  perform set_config(
    'request.jwt.claim.sub',
    '00000000-0000-0000-0000-000000000103',
    true
  );
  perform public.cancel_lesson();

  if (
    select count(*)
    from public.lesson_bookings
    where session_id = '10000000-0000-0000-0000-000000000001'
      and status = 'waiting'
      and position in (1, 2)
  ) <> 2 then
    raise exception '레슨 취소 후 대기열이 다시 정렬되지 않았습니다.';
  end if;
end;
$$;

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '00000000-0000-0000-0000-000000000101',
  true
);

do $$
begin
  if (select count(*) from public.clubs) <> 1 then
    raise exception 'RLS가 다른 동호회 조회를 차단하지 못했습니다.';
  end if;

  if public.get_app_snapshot() -> 'member' ->> 'nickname' <> '회원1' then
    raise exception '앱 스냅샷이 현재 회원 정보를 반환하지 못했습니다.';
  end if;
end;
$$;

reset role;
rollback;
