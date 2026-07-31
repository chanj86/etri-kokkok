create or replace function public.get_my_partner_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  actor_club_id uuid := public.current_club_id();
  partner_stats jsonb;
begin
  if actor_id is null or actor_club_id is null then
    raise exception '파트너 전적을 확인하려면 로그인이 필요합니다.';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'memberId', summary.partner_id,
        'nickname', summary.nickname,
        'games', summary.games,
        'wins', summary.wins,
        'losses', summary.games - summary.wins,
        'winRate', round(summary.wins * 100.0 / summary.games)::integer,
        'lastPlayedAt', summary.last_played_at
      )
      order by
        summary.wins desc,
        summary.games desc,
        summary.nickname
    ),
    '[]'::jsonb
  )
  into partner_stats
  from (
    select
      teammate.member_id as partner_id,
      partner.nickname,
      count(*)::integer as games,
      count(*) filter (
        where mine.team = result.winner_team
      )::integer as wins,
      max(coalesce(slot.completed_at, result.updated_at)) as last_played_at
    from public.game_slot_players mine
    join public.game_slot_players teammate
      on teammate.slot_id = mine.slot_id
      and teammate.team = mine.team
      and teammate.member_id <> mine.member_id
    join public.members partner
      on partner.id = teammate.member_id
      and partner.club_id = actor_club_id
    join public.game_slots slot
      on slot.id = mine.slot_id
      and slot.club_id = actor_club_id
      and slot.status = 'completed'
    join public.game_results result on result.slot_id = slot.id
    where mine.member_id = actor_id
    group by teammate.member_id, partner.nickname
  ) summary;

  return partner_stats;
end;
$$;

revoke all on function public.get_my_partner_stats() from public;
grant execute on function public.get_my_partner_stats() to authenticated;
