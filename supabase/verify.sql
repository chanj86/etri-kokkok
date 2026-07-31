-- ETRI 콕콕 연동 점검 쿼리
-- Supabase SQL Editor 에 붙여 넣고 실행한 뒤 결과 표를 확인하세요.
-- 읽기 전용이므로 데이터를 변경하지 않습니다.

select
  '1. 동호회' as 항목,
  count(*)::text || '개 (' || coalesce(string_agg(name, ', '), '없음') || ')' as 결과,
  case when count(*) = 1 then '정상' else '확인 필요' end as 판정
from public.clubs

union all

select
  '2. 가입 회원',
  count(*)::text || '명 (' || coalesce(string_agg(nickname || ':' || role, ', '), '없음') || ')',
  case when count(*) >= 1 then '정상' else '가입 필요' end
from public.members

union all

select
  '3. 관리자 계정',
  count(*)::text || '명',
  case when count(*) = 1 then '정상' else '확인 필요' end
from public.members
where role = 'owner'

union all

select
  '4. 인증 계정 연결',
  count(*)::text || '명',
  case
    when count(*) = (select count(*) from public.members) then '정상'
    else '확인 필요'
  end
from public.members m
join auth.users u on u.id = m.id

union all

select
  '5. 알림 예약 작업',
  coalesce(string_agg(jobname || ' / ' || schedule, ', '), '없음'),
  case when count(*) = 1 then '정상' else 'cron.local.sql 실행 필요' end
from cron.job
where jobname = 'notify-lesson-every-minute'

union all

select
  '6. 최근 알림 실행 이력',
  coalesce(
    count(*)::text || '회 (최근 상태: '
      || coalesce(max(status) filter (where end_time is not null), '대기 중') || ')',
    '없음'
  ),
  case when count(*) >= 1 then '정상' else '1분 후 다시 확인' end
from cron.job_run_details
where jobid in (
  select jobid from cron.job where jobname = 'notify-lesson-every-minute'
)
and start_time > now() - interval '10 minutes'

order by 항목;
