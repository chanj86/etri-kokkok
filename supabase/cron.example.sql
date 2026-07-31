-- Supabase SQL Editor에서 플레이스홀더를 실제 값으로 바꾼 뒤 한 번 실행한다.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

select vault.create_secret(
  'https://YOUR_PROJECT_REF.supabase.co',
  'project_url'
);
select vault.create_secret('YOUR_SUPABASE_ANON_KEY', 'anon_key');
select vault.create_secret('YOUR_RANDOM_CRON_SECRET', 'notification_cron_secret');

select cron.schedule(
  'notify-lesson-every-minute',
  '* * * * *',
  $$
  select net.http_post(
    url := (
      select decrypted_secret
      from vault.decrypted_secrets
      where name = 'project_url'
    ) || '/functions/v1/notify-lesson',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'anon_key'
      ),
      'x-cron-secret', (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'notification_cron_secret'
      )
    ),
    body := jsonb_build_object('triggeredAt', now()),
    timeout_milliseconds := 10000
  );
  $$
);
