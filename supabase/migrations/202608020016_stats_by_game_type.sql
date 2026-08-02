-- 앱 스냅샷 v8: 회원 전적을 종합/단식/복식으로 나눠 제공한다.
-- 내 기록(records.singles/doubles)과 회원 목록(singlesGames 등)에 반영된다.

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
