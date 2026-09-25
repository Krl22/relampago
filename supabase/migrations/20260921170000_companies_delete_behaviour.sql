-- Eliminar una empresa: sus pedidos y perfiles de cliente quedan sin empresa (historial intacto),
-- direcciones/stock/liquidaciones se borran en cascada, recojos quedan sin empresa.
alter table public.orders drop constraint if exists orders_company_id_fkey;
alter table public.orders
  add constraint orders_company_id_fkey foreign key (company_id) references public.companies(id) on delete set null;

alter table public.profiles drop constraint if exists profiles_company_id_fkey;
alter table public.profiles
  add constraint profiles_company_id_fkey foreign key (company_id) references public.companies(id) on delete set null;
