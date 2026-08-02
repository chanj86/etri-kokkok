-- 외부게임 매칭 글에 날짜·시간·장소·모집 인원을 추가하고,
-- 회원이 참석 버튼으로 지원할 수 있게 한다. (정원 대비 참석 인원 표시)

-- 1. posts 확장 ---------------------------------------------------------------

alter table public.posts
  add column if not exists event_date date,
  add column if not exists event_time time,
  add column if not exists location text
    check (location is null or char_length(location) between 1 and 80),
  add column if not exists capacity integer
    check (capacity is null or capacity between 1 and 99);

-- 2. 참석자 테이블 ------------------------------------------------------------

create table if not exists public.post_participants (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  post_id uuid not null references public.posts(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (post_id, member_id)
);

create index if not exists post_participants_post_idx
  on public.post_participants (post_id, created_at);

alter table public.post_participants enable row level security;

drop policy if exists post_participants_read_same_club
  on public.post_participants;
create policy post_participants_read_same_club
on public.post_participants
for select
to authenticated
using (public.is_active_member_of(club_id));

grant select on public.post_participants to authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'post_participants'
  ) then
    execute
      'alter publication supabase_realtime add table public.post_participants';
  end if;
end;
$$;

-- 3. 글 작성: 매칭 글은 날짜·시간·장소·모집 인원이 필수 ------------------------

drop function if exists public.create_post(public.post_category, text, text);

create or replace function public.create_post(
  p_category public.post_category,
  p_title text,
  p_content text,
  p_event_date date default null,
  p_event_time time default null,
  p_location text default null,
  p_capacity integer default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.members%rowtype;
  new_post_id uuid;
begin
  select * into actor
  from public.members
  where id = auth.uid() and is_active;

  if actor.id is null then
    raise exception '활성 회원만 글을 쓸 수 있습니다.';
  end if;

  if p_category = 'notice' and actor.role <> 'owner' then
    raise exception '공지사항은 관리자만 작성할 수 있습니다.';
  end if;

  if char_length(trim(p_title)) not between 1 and 80 then
    raise exception '제목은 1자 이상 80자 이하로 입력해 주세요.';
  end if;

  if char_length(trim(p_content)) not between 1 and 2000 then
    raise exception '내용은 1자 이상 2000자 이하로 입력해 주세요.';
  end if;

  if p_category = 'matching' then
    if p_event_date is null then
      raise exception '게임 날짜를 선택해 주세요.';
    end if;
    if p_event_time is null then
      raise exception '게임 시간을 선택해 주세요.';
    end if;
    if p_location is null
      or char_length(trim(p_location)) not between 1 and 80 then
      raise exception '장소는 1자 이상 80자 이하로 입력해 주세요.';
    end if;
    if p_capacity is null or p_capacity not between 1 and 99 then
      raise exception '모집 인원은 1명 이상 99명 이하로 입력해 주세요.';
    end if;
  end if;

  insert into public.posts (
    club_id,
    author_id,
    category,
    title,
    content,
    event_date,
    event_time,
    location,
    capacity
  )
  values (
    actor.club_id,
    actor.id,
    p_category,
    trim(p_title),
    trim(p_content),
    case when p_category = 'matching' then p_event_date end,
    case when p_category = 'matching' then p_event_time end,
    case when p_category = 'matching' then trim(p_location) end,
    case when p_category = 'matching' then p_capacity end
  )
  returning id into new_post_id;

  return new_post_id;
end;
$$;

revoke all on function public.create_post(
  public.post_category, text, text, date, time, text, integer
) from public;
grant execute on function public.create_post(
  public.post_category, text, text, date, time, text, integer
) to authenticated;

-- 4. 매칭 글 참석 / 참석 취소 ---------------------------------------------------

create or replace function public.join_post(p_post_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.members%rowtype;
  target public.posts%rowtype;
  joined_count integer;
  inserted_id uuid;
begin
  select * into actor
  from public.members
  where id = auth.uid() and is_active;

  if actor.id is null then
    raise exception '활성 회원만 참석할 수 있습니다.';
  end if;

  select * into target
  from public.posts
  where id = p_post_id
    and club_id = actor.club_id
  for update;

  if target.id is null then
    raise exception '참석할 글을 찾을 수 없습니다.';
  end if;

  if target.category <> 'matching' then
    raise exception '외부게임 매칭 글에만 참석할 수 있습니다.';
  end if;

  select count(*)::integer
  into joined_count
  from public.post_participants
  where post_id = p_post_id;

  if target.capacity is not null and joined_count >= target.capacity then
    raise exception '모집 인원이 가득 찼습니다.';
  end if;

  insert into public.post_participants (club_id, post_id, member_id)
  values (actor.club_id, p_post_id, actor.id)
  on conflict (post_id, member_id) do nothing
  returning id into inserted_id;

  if inserted_id is null then
    raise exception '이미 참석한 글입니다.';
  end if;
end;
$$;

create or replace function public.leave_post(p_post_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  actor_club_id uuid := public.current_club_id();
begin
  if actor_club_id is null then
    raise exception '로그인이 필요합니다.';
  end if;

  delete from public.post_participants
  where post_id = p_post_id
    and member_id = actor_id
    and club_id = actor_club_id;

  if not found then
    raise exception '참석 중인 글이 아닙니다.';
  end if;
end;
$$;

revoke all on function public.join_post(uuid) from public;
revoke all on function public.leave_post(uuid) from public;
grant execute on function public.join_post(uuid) to authenticated;
grant execute on function public.leave_post(uuid) to authenticated;

-- 5. 앱 스냅샷 v4: 게시글에 일정·정원·참석자 포함 --------------------------------

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
