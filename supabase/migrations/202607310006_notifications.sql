create or replace function public.save_push_subscription(p_subscription jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  actor_club_id uuid := public.current_club_id();
  endpoint_value text := p_subscription ->> 'endpoint';
  p256dh_value text := p_subscription #>> '{keys,p256dh}';
  auth_value text := p_subscription #>> '{keys,auth}';
  subscription_id uuid;
begin
  if actor_club_id is null then
    raise exception '알림을 설정하려면 로그인이 필요합니다.';
  end if;

  if endpoint_value is null
    or p256dh_value is null
    or auth_value is null then
    raise exception '올바르지 않은 푸시 구독 정보입니다.';
  end if;

  insert into public.push_subscriptions (
    club_id,
    member_id,
    endpoint,
    p256dh,
    auth_key
  )
  values (
    actor_club_id,
    actor_id,
    endpoint_value,
    p256dh_value,
    auth_value
  )
  on conflict (endpoint)
  do update set
    club_id = excluded.club_id,
    member_id = excluded.member_id,
    p256dh = excluded.p256dh,
    auth_key = excluded.auth_key,
    updated_at = now()
  returning id into subscription_id;

  return subscription_id;
end;
$$;

create or replace function public.claim_due_lesson_notifications(
  p_limit integer default 100
)
returns table (
  notification_id uuid,
  endpoint text,
  p256dh text,
  auth_key text,
  title text,
  body text,
  target_url text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.notification_logs
  set
    status = 'pending',
    error_message = '이전 발송 작업이 중단되어 재시도합니다.'
  where status = 'processing'
    and updated_at < now() - interval '5 minutes';

  insert into public.notification_logs (
    club_id,
    member_id,
    booking_id,
    subscription_id,
    scheduled_for,
    status
  )
  select
    booking.club_id,
    booking.member_id,
    booking.id,
    subscription.id,
    booking.estimated_start_at,
    'pending'
  from public.lesson_bookings booking
  join public.push_subscriptions subscription
    on subscription.member_id = booking.member_id
  where booking.status = 'waiting'
    and booking.estimated_start_at - interval '15 minutes' <= now()
    and booking.estimated_start_at > now() - interval '3 minutes'
  on conflict (booking_id, subscription_id, scheduled_for) do nothing;

  return query
  with due as (
    select log.id
    from public.notification_logs log
    where log.status = 'pending'
      and log.scheduled_for - interval '15 minutes' <= now()
    order by log.scheduled_for
    for update skip locked
    limit greatest(1, least(p_limit, 500))
  ),
  claimed as (
    update public.notification_logs log
    set status = 'processing'
    from due
    where log.id = due.id
    returning log.*
  )
  select
    claimed.id,
    subscription.endpoint,
    subscription.p256dh,
    subscription.auth_key,
    '레슨 시작 15분 전'::text,
    (
      member.nickname
      || '님, '
      || to_char(
        claimed.scheduled_for at time zone 'Asia/Seoul',
        'HH24:MI'
      )
      || ' 레슨을 준비해 주세요.'
    )::text,
    '/lesson'::text
  from claimed
  join public.push_subscriptions subscription
    on subscription.id = claimed.subscription_id
  join public.members member on member.id = claimed.member_id;
end;
$$;

create or replace function public.finish_lesson_notification(
  p_notification_id uuid,
  p_success boolean,
  p_error_message text default null
)
returns void
language sql
security definer
set search_path = public
as $$
  update public.notification_logs
  set
    status = case when p_success then 'sent' else 'failed' end,
    sent_at = case when p_success then now() else null end,
    error_message = case
      when p_success then null
      else left(coalesce(p_error_message, '알 수 없는 전송 오류'), 500)
    end
  where id = p_notification_id
    and status = 'processing';
$$;

revoke all on function public.save_push_subscription(jsonb) from public;
revoke all on function public.claim_due_lesson_notifications(integer)
from public, anon, authenticated;
revoke all on function public.finish_lesson_notification(
  uuid,
  boolean,
  text
) from public, anon, authenticated;

grant execute on function public.save_push_subscription(jsonb)
to authenticated;
grant execute on function public.claim_due_lesson_notifications(integer)
to service_role;
grant execute on function public.finish_lesson_notification(
  uuid,
  boolean,
  text
) to service_role;
