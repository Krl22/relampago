-- Run after provisioning the named worker secret in Vault and deploying telegram-worker.
-- The cron command contains only the Vault secret NAME, never its value.
create extension if not exists pg_net with schema extensions;
-- Keep the net schema outside the Data API's exposed schemas. Database login is
-- for trusted operators only: pg_net temporarily queues outbound headers there.
select cron.schedule('relampago-telegram-every-minute','* * * * *',
  $cron$select net.http_post(
    url:='https://pkmrhlbaemgoaegspfnp.supabase.co/functions/v1/telegram-worker',
    headers:=jsonb_build_object('Content-Type','application/json','X-Chatbot-Worker-Secret',
      (select decrypted_secret from vault.decrypted_secrets where name='relampago_chat_worker_secret')),
    body:='{}'::jsonb,timeout_milliseconds:=145000
  );$cron$);
