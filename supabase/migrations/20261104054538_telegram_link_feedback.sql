-- Non-sensitive receipt diagnostics; never store message text, nonce or confirmation code here.
alter table public.chat_telegram_accounts add column last_webhook_at timestamptz;
alter table public.chat_telegram_accounts add column last_webhook_state text;
alter table public.chat_telegram_deliveries drop constraint chat_telegram_deliveries_kind_check;
alter table public.chat_telegram_deliveries add constraint chat_telegram_deliveries_kind_check
  check (kind in ('reply','reminder','link','notice'));
