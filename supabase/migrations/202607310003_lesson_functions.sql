create or replace function public.resequence_lesson_queue(target_session_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  with ranked as (
    select
      lb.id,
      row_number() over (order by lb.joined_at, lb.id) as next_position,
      greatest(
        ls.starts_at,
        min(lb.joined_at) over ()
      ) as first_start,
      ls.duration_minutes
    from public.lesson_bookings lb
    join public.lesson_sessions ls on ls.id = lb.session_id
    where lb.session_id = target_session_id
      and lb.status = 'waiting'
  )
  update public.lesson_bookings booking
  set
    position = ranked.next_position,
    estimated_start_at =
      ranked.first_start
      + ((ranked.next_position - 1) * ranked.duration_minutes) * interval '1 minute'
  from ranked
  where booking.id = ranked.id;
end;
$$;

revoke all on function public.resequence_lesson_queue(uuid)
from public, anon, authenticated;

create or replace function public.join_lesson()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  actor_club_id uuid;
  today_seoul date := public.seoul_today();
  target_session_id uuid;
  booking_id uuid;
begin
  select club_id
  into actor_club_id
  from public.members
  where id = actor_id
    and is_active;

  if actor_club_id is null then
    raise exception '활성 회원만 레슨에 참석할 수 있습니다.';
  end if;

  if timezone('Asia/Seoul', now())::time < time '17:00' then
    raise exception '레슨 참석은 오후 5시 이후 코트에 도착한 뒤 가능합니다.';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      actor_club_id::text || ':lesson:' || today_seoul::text,
      0
    )
  );

  insert into public.lesson_sessions (
    club_id,
    session_date,
    starts_at
  )
  values (
    actor_club_id,
    today_seoul,
    (today_seoul + time '17:00') at time zone 'Asia/Seoul'
  )
  on conflict (club_id, session_date) do nothing;

  select id
  into target_session_id
  from public.lesson_sessions
  where club_id = actor_club_id
    and session_date = today_seoul
    and status = 'open'
  for update;

  if target_session_id is null then
    raise exception '오늘 레슨 접수가 종료되었습니다.';
  end if;

  if exists (
    select 1
    from public.lesson_bookings
    where session_id = target_session_id
      and member_id = actor_id
      and status in ('waiting', 'completed')
  ) then
    raise exception '이미 오늘 레슨에 참석했습니다.';
  end if;

  insert into public.lesson_bookings (
    club_id,
    session_id,
    member_id,
    position,
    estimated_start_at
  )
  values (
    actor_club_id,
    target_session_id,
    actor_id,
    (
      select count(*)::integer + 1
      from public.lesson_bookings
      where session_id = target_session_id
        and status = 'waiting'
    ),
    clock_timestamp()
  )
  returning id into booking_id;

  perform public.resequence_lesson_queue(target_session_id);
  return booking_id;
end;
$$;

create or replace function public.delay_lesson()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  target_session_id uuid;
  actor_club_id uuid;
begin
  select club_id
  into actor_club_id
  from public.members
  where id = actor_id
    and is_active;

  if actor_club_id is null then
    raise exception '활성 회원 정보를 찾을 수 없습니다.';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      actor_club_id::text || ':lesson:' || public.seoul_today()::text,
      0
    )
  );

  select lb.session_id
  into target_session_id
  from public.lesson_bookings lb
  join public.lesson_sessions ls on ls.id = lb.session_id
  where lb.member_id = actor_id
    and ls.session_date = public.seoul_today()
    and lb.status = 'waiting'
  for update of lb;

  if target_session_id is null then
    raise exception '미룰 수 있는 레슨 참석이 없습니다.';
  end if;

  update public.lesson_bookings
  set joined_at = clock_timestamp()
  where session_id = target_session_id
    and member_id = actor_id
    and status = 'waiting';

  perform public.resequence_lesson_queue(target_session_id);
end;
$$;

create or replace function public.cancel_lesson()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  target_session_id uuid;
  actor_club_id uuid;
begin
  select club_id
  into actor_club_id
  from public.members
  where id = actor_id
    and is_active;

  if actor_club_id is null then
    raise exception '활성 회원 정보를 찾을 수 없습니다.';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      actor_club_id::text || ':lesson:' || public.seoul_today()::text,
      0
    )
  );

  select lb.session_id
  into target_session_id
  from public.lesson_bookings lb
  join public.lesson_sessions ls on ls.id = lb.session_id
  where lb.member_id = actor_id
    and ls.session_date = public.seoul_today()
    and lb.status = 'waiting'
  for update of lb;

  if target_session_id is null then
    raise exception '취소할 수 있는 레슨 참석이 없습니다.';
  end if;

  update public.lesson_bookings
  set status = 'cancelled'
  where session_id = target_session_id
    and member_id = actor_id
    and status = 'waiting';

  perform public.resequence_lesson_queue(target_session_id);
end;
$$;

create or replace function public.update_my_profile(
  p_nickname text,
  p_gender public.gender_type,
  p_experience_months integer,
  p_prior_lesson_count integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  normalized_name text := public.normalize_member_name(p_nickname);
begin
  if actor_id is null then
    raise exception '로그인이 필요합니다.';
  end if;

  if char_length(trim(p_nickname)) not between 2 and 20 then
    raise exception '닉네임은 2자 이상 20자 이하로 입력해 주세요.';
  end if;

  if p_experience_months not between 0 and 600 then
    raise exception '구력은 0개월 이상 600개월 이하로 입력해 주세요.';
  end if;

  if p_prior_lesson_count not between 0 and 9999 then
    raise exception '기존 레슨 횟수를 확인해 주세요.';
  end if;

  update public.members
  set
    nickname = trim(p_nickname),
    nickname_normalized = normalized_name,
    gender = p_gender,
    experience_months = p_experience_months,
    prior_lesson_count = p_prior_lesson_count
  where id = actor_id
    and is_active;

  if not found then
    raise exception '활성 회원 정보를 찾을 수 없습니다.';
  end if;

  update public.member_credentials
  set login_name_normalized = normalized_name
  where member_id = actor_id;
exception
  when unique_violation then
    raise exception '같은 동호회에서 이미 사용 중인 닉네임입니다.';
end;
$$;

revoke all on function public.join_lesson() from public;
revoke all on function public.delay_lesson() from public;
revoke all on function public.cancel_lesson() from public;
revoke all on function public.update_my_profile(
  text,
  public.gender_type,
  integer,
  integer
) from public;

grant execute on function public.join_lesson() to authenticated;
grant execute on function public.delay_lesson() to authenticated;
grant execute on function public.cancel_lesson() to authenticated;
grant execute on function public.update_my_profile(
  text,
  public.gender_type,
  integer,
  integer
) to authenticated;
