-- Add a provider without changing keys, history or business-data permissions.
alter table public.chat_credentials drop constraint chat_credentials_provider_check;
alter table public.chat_credentials add constraint chat_credentials_provider_check check(provider in ('openai','anthropic','deepseek'));
alter table public.chat_requests drop constraint chat_requests_provider_check;
alter table public.chat_requests add constraint chat_requests_provider_check check(provider in ('openai','anthropic','deepseek'));
alter table public.chat_telegram_accounts drop constraint chat_telegram_accounts_provider_check;
alter table public.chat_telegram_accounts add constraint chat_telegram_accounts_provider_check check(provider in ('openai','anthropic','deepseek'));
