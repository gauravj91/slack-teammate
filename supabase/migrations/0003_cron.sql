-- Teammate: run schedules and drain the job queue every minute.
-- Vercel Hobby cron only runs once a day, so Supabase pg_cron + pg_net calls our
-- secured endpoint (/api/cron/tick) every minute instead. Both extensions are free.
--
-- BEFORE RUNNING: replace the two placeholder values below
--   1. https://YOUR-APP.vercel.app  -> your Vercel production URL
--   2. YOUR_CRON_SECRET             -> the same value as CRON_SECRET in Vercel
-- The values are stored in Supabase Vault (encrypted), not in the cron job text.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Store (or update) the secrets in Vault.
do $$
begin
  if exists (select 1 from vault.secrets where name = 'teammate_tick_url') then
    perform vault.update_secret((select id from vault.secrets where name = 'teammate_tick_url'),
                                'https://YOUR-APP.vercel.app/api/cron/tick');
  else
    perform vault.create_secret('https://YOUR-APP.vercel.app/api/cron/tick', 'teammate_tick_url');
  end if;

  if exists (select 1 from vault.secrets where name = 'teammate_cron_secret') then
    perform vault.update_secret((select id from vault.secrets where name = 'teammate_cron_secret'),
                                'YOUR_CRON_SECRET');
  else
    perform vault.create_secret('YOUR_CRON_SECRET', 'teammate_cron_secret');
  end if;
end $$;

-- Remove an older copy of the job if you re-run this file.
select cron.unschedule('teammate-tick')
 where exists (select 1 from cron.job where jobname = 'teammate-tick');

select cron.schedule(
  'teammate-tick',
  '* * * * *',
  $$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'teammate_tick_url'),
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'teammate_cron_secret')
               ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 5000
  );
  $$
);

-- Housekeeping: keep cron history small on the free tier (runs daily at 03:00 UTC).
select cron.unschedule('teammate-cleanup')
 where exists (select 1 from cron.job where jobname = 'teammate-cleanup');

select cron.schedule(
  'teammate-cleanup',
  '0 3 * * *',
  $$
  delete from cron.job_run_details where end_time < now() - interval '3 days';
  update public.approvals set status = 'expired' where status = 'pending' and created_at < now() - interval '7 days';
  update public.jobs set status = 'cancelled', updated_at = now()
   where status = 'awaiting_approval' and updated_at < now() - interval '7 days';
  $$
);

-- Check it is running:
--   select * from cron.job;
--   select * from cron.job_run_details order by start_time desc limit 5;
--   select * from net._http_response order by created desc limit 5;
