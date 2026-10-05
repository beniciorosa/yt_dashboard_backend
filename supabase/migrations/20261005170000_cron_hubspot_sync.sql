-- Sync incremental do HubSpot a cada 30 min (resumível; cada chamada cabe nos 60 s da função).
select cron.schedule('sync-hubspot', '*/30 * * * *', $$
    select net.http_get(
        url := 'https://yt-dashboard-backend.vercel.app/api/hubspot/sync',
        headers := jsonb_build_object('x-cron-secret', (select value from public.app_secrets where name = 'cron_secret')),
        timeout_milliseconds := 60000)
$$);
