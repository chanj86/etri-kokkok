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

do $$
declare
  first_slot uuid;
  second_slot uuid;
  auto_slot uuid;
  third_slot uuid;
  ahead_slot uuid;
  reuse_slot uuid;
  current_round integer;
  member_101_cycle integer;
  member_101_games integer;
  blocked boolean := false;
  user_id uuid;
  notice_id uuid;
  matching_id uuid;
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
  first_slot := public.create_game_slot('코트 B');
  second_slot := public.create_game_slot('코트 C');

  -- 허용되지 않은 코트 이름은 거부한다.
  blocked := false;
  begin
    perform public.create_game_slot('1번 코트');
  exception when others then
    blocked := true;
  end;
  if not blocked then
    raise exception '허용되지 않은 코트 이름이 차단되지 않았습니다.';
  end if;

  -- 같은 코트에 활성 게임이 있으면 새 게임을 만들 수 없다.
  blocked := false;
  begin
    perform public.create_game_slot('코트 B');
  exception when others then
    blocked := true;
  end;
  if not blocked then
    raise exception '사용 중인 코트의 중복 생성이 차단되지 않았습니다.';
  end if;

  for user_id in
    select
      ('00000000-0000-0000-0000-' || lpad(value::text, 12, '0'))::uuid
    from generate_series(101, 104) as value
  loop
    perform set_config('request.jwt.claim.sub', user_id::text, true);
    perform public.join_game_slot(first_slot);
  end loop;

  -- 활성 슬롯에 참여 중이면 다른 슬롯에 들어갈 수 없다.
  perform set_config(
    'request.jwt.claim.sub',
    '00000000-0000-0000-0000-000000000101',
    true
  );
  blocked := false;
  begin
    perform public.join_game_slot(second_slot);
  exception
    when others then
      blocked := true;
  end;
  if not blocked then
    raise exception '활성 슬롯 참여 중 다른 슬롯 참여가 차단되지 않았습니다.';
  end if;

  for user_id in
    select
      ('00000000-0000-0000-0000-' || lpad(value::text, 12, '0'))::uuid
    from generate_series(105, 106) as value
  loop
    perform set_config('request.jwt.claim.sub', user_id::text, true);
    perform public.join_game_slot(second_slot);
  end loop;

  -- 참여(join)만으로는 순환이 올라가지 않는다.
  select current_cycle
  into current_round
  from public.game_days
  where club_id = '00000000-0000-0000-0000-000000000001'
    and game_date = public.seoul_today();
  if current_round <> 1 then
    raise exception '게임을 완료하지 않았는데 순환이 증가했습니다.';
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

  -- 아직 게임을 완료하지 않은 회원(105, 106)이 있으므로 순환은 1에 머문다.
  select current_cycle
  into current_round
  from public.game_days
  where club_id = '00000000-0000-0000-0000-000000000001'
    and game_date = public.seoul_today();
  if current_round <> 1 then
    raise exception '일부 회원만 완료했는데 순환이 증가했습니다.';
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

  -- 권고 순환: 이미 이번 순환에서 게임을 완료한 101, 102도 참여할 수 있다.
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
    raise exception '순환을 앞선 참여(권고 순환)가 허용되지 않았습니다.';
  end if;

  perform public.start_game_slot(second_slot);
  perform public.complete_game_slot(second_slot, 18, 21);

  -- 모든 활성 회원이 게임을 완료했으므로 순환이 2로 열린다.
  select current_cycle
  into current_round
  from public.game_days
  where club_id = '00000000-0000-0000-0000-000000000001'
    and game_date = public.seoul_today();
  if current_round <> 2 then
    raise exception '전원 게임 완료 후 다음 순환이 열리지 않았습니다.';
  end if;

  perform set_config(
    'request.jwt.claim.sub',
    '00000000-0000-0000-0000-000000000102',
    true
  );
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

  perform set_config(
    'request.jwt.claim.sub',
    '00000000-0000-0000-0000-000000000101',
    true
  );
  auto_slot := public.confirm_auto_arrangement(
    '코트 A',
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

  -- 자동 배치 생성만으로는 순환이 올라가지 않는다.
  select current_cycle
  into current_round
  from public.game_days
  where club_id = '00000000-0000-0000-0000-000000000001'
    and game_date = public.seoul_today();
  if current_round <> 2 then
    raise exception '자동 배치 생성이 순환을 증가시켰습니다.';
  end if;

  perform public.start_game_slot(auto_slot);
  perform public.complete_game_slot(auto_slot, 21, 15);

  third_slot := public.create_game_slot('코트 B');
  for user_id in
    select
      ('00000000-0000-0000-0000-' || lpad(value::text, 12, '0'))::uuid
    from generate_series(101, 104) as value
  loop
    perform set_config('request.jwt.claim.sub', user_id::text, true);
    perform public.join_game_slot(third_slot);
  end loop;

  perform set_config(
    'request.jwt.claim.sub',
    '00000000-0000-0000-0000-000000000101',
    true
  );
  perform public.start_game_slot(third_slot);
  perform public.complete_game_slot(third_slot, 21, 10);

  -- 전원(101~106)이 순환 2에서 게임을 완료했으므로 순환이 3으로 열린다.
  select current_cycle
  into current_round
  from public.game_days
  where club_id = '00000000-0000-0000-0000-000000000001'
    and game_date = public.seoul_today();
  if current_round <> 3 then
    raise exception '두 번째 순환 완료 후 다음 순환이 열리지 않았습니다.';
  end if;

  -- 게임 취소: 완료 전에는 순환·전적에 아무 영향이 없어야 한다. --------------
  ahead_slot := public.create_game_slot('코트 C');
  perform public.join_game_slot(ahead_slot);

  if (
    select count(*)
    from public.game_slot_players
    where slot_id = ahead_slot
      and member_id = '00000000-0000-0000-0000-000000000101'
  ) <> 1 then
    raise exception '순환을 앞선 참여가 허용되지 않았습니다.';
  end if;

  select last_joined_cycle, games_played
  into member_101_cycle, member_101_games
  from public.game_attendances
  where member_id = '00000000-0000-0000-0000-000000000101'
    and game_day_id = (
      select id
      from public.game_days
      where club_id = '00000000-0000-0000-0000-000000000001'
        and game_date = public.seoul_today()
    );

  perform public.cancel_game_slot(ahead_slot);

  if (
    select status
    from public.game_slots
    where id = ahead_slot
  ) <> 'cancelled' then
    raise exception '게임 취소가 반영되지 않았습니다.';
  end if;

  if (
    select last_joined_cycle
    from public.game_attendances
    where member_id = '00000000-0000-0000-0000-000000000101'
      and game_day_id = (
        select id
        from public.game_days
        where club_id = '00000000-0000-0000-0000-000000000001'
          and game_date = public.seoul_today()
      )
  ) <> member_101_cycle
    or (
      select games_played
      from public.game_attendances
      where member_id = '00000000-0000-0000-0000-000000000101'
        and game_day_id = (
          select id
          from public.game_days
          where club_id = '00000000-0000-0000-0000-000000000001'
            and game_date = public.seoul_today()
        )
    ) <> member_101_games then
    raise exception '게임 취소가 순환·전적 상태를 바꾸었습니다.';
  end if;

  select current_cycle
  into current_round
  from public.game_days
  where club_id = '00000000-0000-0000-0000-000000000001'
    and game_date = public.seoul_today();
  if current_round <> 3 then
    raise exception '게임 취소가 순환 횟수를 바꾸었습니다.';
  end if;

  -- 취소된 코트는 다시 사용할 수 있다.
  reuse_slot := public.create_game_slot('코트 C');
  perform public.cancel_game_slot(reuse_slot);

  -- 게시판: 공지는 관리자만, 매칭 글은 모두 작성할 수 있다. -----------------
  notice_id := public.create_post(
    'notice',
    '이번 주 운영 안내',
    '수요일은 레슨이 없습니다.'
  );

  perform set_config(
    'request.jwt.claim.sub',
    '00000000-0000-0000-0000-000000000102',
    true
  );
  blocked := false;
  begin
    perform public.create_post('notice', '일반 회원 공지', '작성 시도');
  exception when others then
    blocked := true;
  end;
  if not blocked then
    raise exception '일반 회원의 공지 작성이 차단되지 않았습니다.';
  end if;

  -- 매칭 글은 날짜·시간·장소·모집 인원이 필수다.
  blocked := false;
  begin
    perform public.create_post('matching', '필드 없는 매칭', '검증용');
  exception when others then
    blocked := true;
  end;
  if not blocked then
    raise exception '매칭 글 필수 항목 검증이 동작하지 않았습니다.';
  end if;

  matching_id := public.create_post(
    'matching',
    '토요일 외부 게스트 게임',
    '게스트 2명 모집합니다.',
    public.seoul_today() + 7,
    time '19:30',
    '유성구민체육관',
    2
  );

  -- 참석: 103 참석, 중복 참석은 차단된다.
  perform set_config(
    'request.jwt.claim.sub',
    '00000000-0000-0000-0000-000000000103',
    true
  );
  perform public.join_post(matching_id);

  blocked := false;
  begin
    perform public.join_post(matching_id);
  exception when others then
    blocked := true;
  end;
  if not blocked then
    raise exception '중복 참석이 차단되지 않았습니다.';
  end if;

  -- 104 참석으로 정원(2명)이 차면 105는 참석할 수 없다.
  perform set_config(
    'request.jwt.claim.sub',
    '00000000-0000-0000-0000-000000000104',
    true
  );
  perform public.join_post(matching_id);

  perform set_config(
    'request.jwt.claim.sub',
    '00000000-0000-0000-0000-000000000105',
    true
  );
  blocked := false;
  begin
    perform public.join_post(matching_id);
  exception when others then
    blocked := true;
  end;
  if not blocked then
    raise exception '정원 초과 참석이 차단되지 않았습니다.';
  end if;

  -- 103이 참석을 취소하면 105가 참석할 수 있다.
  perform set_config(
    'request.jwt.claim.sub',
    '00000000-0000-0000-0000-000000000103',
    true
  );
  perform public.leave_post(matching_id);

  perform set_config(
    'request.jwt.claim.sub',
    '00000000-0000-0000-0000-000000000105',
    true
  );
  perform public.join_post(matching_id);

  if (
    select count(*)
    from public.post_participants
    where post_id = matching_id
  ) <> 2 then
    raise exception '매칭 참석 인원 집계가 정확하지 않습니다.';
  end if;

  -- 글을 삭제하면 참석 기록도 함께 정리된다.
  perform set_config(
    'request.jwt.claim.sub',
    '00000000-0000-0000-0000-000000000102',
    true
  );
  perform public.delete_post(matching_id);

  if exists (select 1 from public.posts where id = matching_id) then
    raise exception '본인 글 삭제가 동작하지 않았습니다.';
  end if;

  if exists (
    select 1
    from public.post_participants
    where post_id = matching_id
  ) then
    raise exception '글 삭제 시 참석 기록이 정리되지 않았습니다.';
  end if;

  if not exists (select 1 from public.posts where id = notice_id) then
    raise exception '공지 글이 저장되지 않았습니다.';
  end if;

  -- 스냅샷 검증용 매칭 글 (102 작성, 본인 참석 1/4)
  matching_id := public.create_post(
    'matching',
    '일요일 교류전',
    '복식 2팀 모집합니다.',
    public.seoul_today() + 8,
    time '10:00',
    '반석체육관',
    4
  );
  perform public.join_post(matching_id);

  -- 프로필 사진 주소 검증 ---------------------------------------------------
  perform public.update_my_avatar('https://example.invalid/avatar.jpg');
  if (
    select avatar_url
    from public.members
    where id = '00000000-0000-0000-0000-000000000102'
  ) <> 'https://example.invalid/avatar.jpg' then
    raise exception '프로필 사진 주소가 저장되지 않았습니다.';
  end if;

  blocked := false;
  begin
    perform public.update_my_avatar('javascript:alert(1)');
  exception when others then
    blocked := true;
  end;
  if not blocked then
    raise exception '잘못된 사진 주소가 차단되지 않았습니다.';
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

-- 레슨 시간 재계산: 자동 완료, 진행 중 기준 연쇄 계산, 변경·리마인더 알림 ------
do $$
declare
  claimed_total integer;
  claimed_changed integer;
  claimed_before5 integer;
begin
  -- (1) 예정 시간 + 15분이 지난 레슨은 자동으로 완료 처리된다.
  update public.lesson_bookings
  set
    estimated_start_at = now() - interval '20 minutes',
    joined_at = now() - interval '50 minutes'
  where session_id = '10000000-0000-0000-0000-000000000001'
    and member_id = '00000000-0000-0000-0000-000000000101'
    and status = 'waiting';

  perform public.resequence_lesson_queue(
    '10000000-0000-0000-0000-000000000001'
  );

  if (
    select status
    from public.lesson_bookings
    where session_id = '10000000-0000-0000-0000-000000000001'
      and member_id = '00000000-0000-0000-0000-000000000101'
  ) <> 'completed' then
    raise exception '예정 시간이 지난 레슨이 자동 완료되지 않았습니다.';
  end if;

  if (
    select position
    from public.lesson_bookings
    where session_id = '10000000-0000-0000-0000-000000000001'
      and member_id = '00000000-0000-0000-0000-000000000102'
      and status = 'waiting'
  ) <> 1 then
    raise exception '자동 완료 후 대기열 순번이 당겨지지 않았습니다.';
  end if;

  -- (2) 진행 중 레슨(10분 경과)이 있으면 다음 대기자는
  --     남은 5분 뒤에 시작하는 것으로 계산된다.
  update public.lesson_bookings
  set
    estimated_start_at = now() - interval '10 minutes',
    joined_at = now() - interval '40 minutes'
  where session_id = '10000000-0000-0000-0000-000000000001'
    and member_id = '00000000-0000-0000-0000-000000000102'
    and status = 'waiting';

  insert into public.lesson_bookings (
    id,
    club_id,
    session_id,
    member_id,
    joined_at,
    position,
    estimated_start_at
  )
  values (
    '20000000-0000-0000-0000-000000000103',
    '00000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000103',
    now() - interval '3 minutes',
    99,
    now()
  );

  perform public.resequence_lesson_queue(
    '10000000-0000-0000-0000-000000000001'
  );

  if (
    select estimated_start_at
    from public.lesson_bookings
    where session_id = '10000000-0000-0000-0000-000000000001'
      and member_id = '00000000-0000-0000-0000-000000000102'
      and status = 'waiting'
  ) <> now() - interval '10 minutes' then
    raise exception '진행 중인 레슨의 시작 시각이 유지되지 않았습니다.';
  end if;

  if (
    select estimated_start_at
    from public.lesson_bookings
    where id = '20000000-0000-0000-0000-000000000103'
  ) <> now() + interval '5 minutes' then
    raise exception
      '진행 중 레슨의 남은 시간을 기준으로 다음 시각이 계산되지 않았습니다.';
  end if;

  -- (3) 앞사람이 빠져 시간이 당겨지면 '시간 변경' 알림이 예약된다.
  insert into public.lesson_bookings (
    id,
    club_id,
    session_id,
    member_id,
    joined_at,
    position,
    estimated_start_at
  )
  values (
    '20000000-0000-0000-0000-000000000104',
    '00000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000104',
    now() - interval '2 minutes',
    99,
    now()
  );

  perform public.resequence_lesson_queue(
    '10000000-0000-0000-0000-000000000001'
  );

  if (
    select estimated_start_at
    from public.lesson_bookings
    where id = '20000000-0000-0000-0000-000000000104'
  ) <> now() + interval '20 minutes' then
    raise exception '뒤 대기자의 예상 시각이 연쇄 계산되지 않았습니다.';
  end if;

  -- 방금 만든 예약을 오래된 예약처럼 만들고 알림 구독을 붙인다.
  update public.lesson_bookings
  set created_at = now() - interval '10 minutes'
  where id = '20000000-0000-0000-0000-000000000104';

  insert into public.push_subscriptions (
    club_id,
    member_id,
    endpoint,
    p256dh,
    auth_key
  )
  values (
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000104',
    'https://push.test.invalid/endpoint-104',
    'p256dh-value',
    'auth-value'
  );

  -- 앞 대기자(103)가 취소하면 104의 시간이 15분 당겨진다.
  update public.lesson_bookings
  set status = 'cancelled'
  where id = '20000000-0000-0000-0000-000000000103';

  perform public.resequence_lesson_queue(
    '10000000-0000-0000-0000-000000000001'
  );

  if (
    select estimated_start_at
    from public.lesson_bookings
    where id = '20000000-0000-0000-0000-000000000104'
  ) <> now() + interval '5 minutes' then
    raise exception '취소 후 대기자의 시간이 앞으로 당겨지지 않았습니다.';
  end if;

  if not exists (
    select 1
    from public.notification_logs
    where booking_id = '20000000-0000-0000-0000-000000000104'
      and kind = 'changed'
      and status = 'pending'
  ) then
    raise exception '시간 변경 알림이 예약되지 않았습니다.';
  end if;

  -- (4) 알림 클레임: 시간 변경 + 5분 전 리마인더가 함께 발급된다.
  --     (104의 레슨은 5분 뒤 시작이므로 15분 전 시점은 이미 지났다.)
  create temp table claimed_notifications on commit drop as
  select * from public.claim_due_lesson_notifications(50);

  select count(*) into claimed_total from claimed_notifications;
  select count(*) into claimed_changed
  from claimed_notifications
  where title = '레슨 예상 시간 변경';
  select count(*) into claimed_before5
  from claimed_notifications
  where title = '곧 레슨이 시작됩니다';

  if claimed_total <> 2 or claimed_changed <> 1 or claimed_before5 <> 1 then
    raise exception
      '알림 클레임 결과가 올바르지 않습니다. (전체 %, 변경 %, 5분 전 %)',
      claimed_total, claimed_changed, claimed_before5;
  end if;

  -- (5) 시작까지 여유가 있는 대기자는 15분 전·5분 전 리마인더가 예약만 된다.
  insert into public.push_subscriptions (
    club_id,
    member_id,
    endpoint,
    p256dh,
    auth_key
  )
  values (
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000105',
    'https://push.test.invalid/endpoint-105',
    'p256dh-value',
    'auth-value'
  );

  insert into public.lesson_bookings (
    id,
    club_id,
    session_id,
    member_id,
    joined_at,
    position,
    estimated_start_at
  )
  values (
    '20000000-0000-0000-0000-000000000105',
    '00000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000105',
    now() - interval '1 minute',
    99,
    now()
  );

  perform public.claim_due_lesson_notifications(50);

  if (
    select count(*)
    from public.notification_logs
    where booking_id = '20000000-0000-0000-0000-000000000105'
      and status = 'pending'
      and kind in ('before15', 'before5')
  ) <> 2 then
    raise exception '15분 전·5분 전 리마인더가 예약되지 않았습니다.';
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
declare
  snapshot jsonb;
begin
  if (select count(*) from public.clubs) <> 1 then
    raise exception 'RLS가 다른 동호회 조회를 차단하지 못했습니다.';
  end if;

  snapshot := public.get_app_snapshot();

  if snapshot -> 'member' ->> 'nickname' <> '회원1' then
    raise exception '앱 스냅샷이 현재 회원 정보를 반환하지 못했습니다.';
  end if;

  if jsonb_array_length(snapshot -> 'community' -> 'members') <> 6 then
    raise exception '커뮤니티 회원 목록이 정확하지 않습니다.';
  end if;

  if jsonb_array_length(snapshot -> 'community' -> 'notices') <> 1 then
    raise exception '커뮤니티 공지 목록이 정확하지 않습니다.';
  end if;

  if (snapshot -> 'community' -> 'members' -> 0) ->> 'games' is null then
    raise exception '회원별 전적 집계가 포함되지 않았습니다.';
  end if;

  -- 매칭 글: 일정·정원·참석자 정보가 스냅샷에 포함돼야 한다.
  if (
    snapshot -> 'community' -> 'matching' -> 0 ->> 'capacity'
  )::integer <> 4
    or jsonb_array_length(
      snapshot -> 'community' -> 'matching' -> 0 -> 'participants'
    ) <> 1
    or (snapshot -> 'community' -> 'matching' -> 0 ->> 'myJoined')::boolean
    or (snapshot -> 'community' -> 'matching' -> 0 ->> 'eventTime') <> '10:00'
    or (snapshot -> 'community' -> 'matching' -> 0 ->> 'location')
      <> '반석체육관' then
    raise exception '매칭 글 일정·참석 정보가 스냅샷에 포함되지 않았습니다.';
  end if;

  -- 팀 랭킹: 101+102 조합이 3게임 2승으로 1위여야 한다.
  if jsonb_array_length(snapshot -> 'community' -> 'teamRankings') < 1 then
    raise exception '팀 랭킹이 스냅샷에 포함되지 않았습니다.';
  end if;

  if (
    snapshot -> 'community' -> 'teamRankings' -> 0 ->> 'games'
  )::integer <> 3
    or (
      snapshot -> 'community' -> 'teamRankings' -> 0 ->> 'wins'
    )::integer <> 2 then
    raise exception '팀 랭킹 집계가 정확하지 않습니다.';
  end if;
end;
$$;

reset role;
rollback;
