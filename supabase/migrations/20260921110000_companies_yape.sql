-- A todas las empresas se les paga por Yape: número y titular de la cuenta.
alter table public.companies
  add column if not exists yape_number text,
  add column if not exists yape_holder text;
