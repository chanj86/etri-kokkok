-- 과거 규칙(참여만으로 순환 증가)으로 부풀려진 오늘 자 순환 상태를
-- '게임 완료 기준'으로 재계산한다. 오늘 게임을 완료한 사람만 credit 을 갖는다.
-- (이후 날짜는 game_day 가 새로 만들어지므로 자동으로 1회부터 시작한다.)

do $$
declare
  day_row record;
begin
  for day_row in
    select id
    from public.game_days
    where game_date = public.seoul_today()
  loop
    update public.game_attendances attendance
    set last_joined_cycle = least(
      attendance.last_joined_cycle,
      case when attendance.games_played > 0 then 1 else 0 end
    )
    where attendance.game_day_id = day_row.id;

    update public.game_days
    set current_cycle = 1
    where id = day_row.id;

    perform public.advance_game_cycle_if_complete(day_row.id);
  end loop;
end;
$$;
