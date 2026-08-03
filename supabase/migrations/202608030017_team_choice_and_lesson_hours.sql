-- 1) 게임 참여 시 팀(A/B)을 직접 선택할 수 있다. (미지정 시 자동 배정)
-- 2) 레슨 참석은 월·수·금 17:00-20:00 에만 가능하다.

-- 1. 게임 참여: 팀 선택 ---------------------------------------------------------

drop function if exists public.join_game_slot(uuid);

create or replace function public.join_game_slot(
  p_slot_id uuid,
  p_team public.team_type default null
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
  team_capacity integer;
  cycle_number integer;
  attendance_record public.game_attendances%rowtype;
  player_count integer;
  team_a_count integer;
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
  team_capacity := slot_capacity / 2;

  select
    count(*)::integer,
    count(*) filter (where team = 'A')::integer
  into player_count, team_a_count
  from public.game_slot_players
  where slot_id = p_slot_id;

  if player_count >= slot_capacity then
    raise exception '게임 인원이 이미 가득 찼습니다.';
  end if;

  if p_team is not null then
    if (
      case when p_team = 'A'
        then team_a_count
        else player_count - team_a_count
      end
    ) >= team_capacity then
      raise exception '해당 팀에 빈 자리가 없습니다.';
    end if;
    selected_team := p_team;
  else
    selected_team := case
      when team_a_count < team_capacity then 'A'::public.team_type
      else 'B'::public.team_type
    end;
  end if;

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

revoke all on function public.join_game_slot(uuid, public.team_type)
from public;
grant execute on function public.join_game_slot(uuid, public.team_type)
to authenticated;

-- 2. 레슨 참석: 월·수·금 17:00-20:00 ---------------------------------------------

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

  if extract(isodow from timezone('Asia/Seoul', now())) not in (1, 3, 5)
    or timezone('Asia/Seoul', now())::time < time '17:00'
    or timezone('Asia/Seoul', now())::time >= time '20:00' then
    raise exception
      '레슨 시간이 아닙니다. 레슨은 월수금 17:00-20:00에 진행됩니다.';
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

-- 3. 앱 스냅샷 v9: 레슨 참석 가능 여부에 요일·시간대(월수금 17-20시) 반영 ----

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
  total_singles_games integer := 0;
  total_singles_wins integer := 0;
  total_doubles_games integer := 0;
  total_doubles_wins integer := 0;
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
    extract(isodow from timezone('Asia/Seoul', now())) in (1, 3, 5)
    and timezone('Asia/Seoul', now())::time >= time '17:00'
    and timezone('Asia/Seoul', now())::time < time '20:00'
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
    count(*) filter (where player.team = result.winner_team)::integer,
    count(*) filter (where slot.game_type = 'singles')::integer,
    count(*) filter (
      where slot.game_type = 'singles'
        and player.team = result.winner_team
    )::integer,
    count(*) filter (where slot.game_type = 'doubles')::integer,
    count(*) filter (
      where slot.game_type = 'doubles'
        and player.team = result.winner_team
    )::integer
  into
    total_games,
    total_wins,
    total_singles_games,
    total_singles_wins,
    total_doubles_games,
    total_doubles_wins
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
        'losses', coalesce(stats.games, 0) - coalesce(stats.wins, 0),
        'singlesGames', coalesce(stats.singles_games, 0),
        'singlesWins', coalesce(stats.singles_wins, 0),
        'doublesGames', coalesce(stats.doubles_games, 0),
        'doublesWins', coalesce(stats.doubles_wins, 0)
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
      count(*) filter (where player.team = result.winner_team)::integer as wins,
      count(*) filter (where slot.game_type = 'singles')::integer
        as singles_games,
      count(*) filter (
        where slot.game_type = 'singles'
          and player.team = result.winner_team
      )::integer as singles_wins,
      count(*) filter (where slot.game_type = 'doubles')::integer
        as doubles_games,
      count(*) filter (
        where slot.game_type = 'doubles'
          and player.team = result.winner_team
      )::integer as doubles_wins
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
      'singles', jsonb_build_object(
        'games', total_singles_games,
        'wins', total_singles_wins,
        'losses', total_singles_games - total_singles_wins
      ),
      'doubles', jsonb_build_object(
        'games', total_doubles_games,
        'wins', total_doubles_wins,
        'losses', total_doubles_games - total_doubles_wins
      ),
      'lessonsThisMonth', monthly_lessons
    )
  );
end;
$$;

revoke all on function public.get_app_snapshot() from public;
grant execute on function public.get_app_snapshot() to authenticated;
