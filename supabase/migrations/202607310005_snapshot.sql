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

  return jsonb_build_object(
    'member', jsonb_build_object(
      'id', actor_member.id,
      'clubId', actor_member.club_id,
      'clubName', club_name,
      'nickname', actor_member.nickname,
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
