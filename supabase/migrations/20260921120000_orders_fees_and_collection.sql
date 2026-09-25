-- Dinero por pedido, tal como lo lleva la central en su hoja de entregas:
--   tariff / total_amount : zona tarifaria (T1..T5) y monto del servicio (tarifa + recarga [+ IGV])
--   surcharge             : recarga por pedido grande ("r2" = S/ 2)
--   tariff_zone           : nombre de la zona del mapa de cobertura que determinó la tarifa
--   amount_collected      : lo que realmente se cobró al destinatario (adelantos, parciales)
--   payment_method        : a dónde fue ese dinero: Motorizado (efectivo) / Directo a comercio /
--                           Relampago Courier (cuenta dueño/hermano) / Izipay (tarjeta)
alter table public.orders
  add column if not exists surcharge numeric not null default 0,
  add column if not exists tariff_zone text,
  add column if not exists amount_collected numeric;

alter table public.orders drop constraint if exists orders_surcharge_check;
alter table public.orders add constraint orders_surcharge_check check (surcharge >= 0 and surcharge <= 500);

-- Empresas: condiciones comerciales
alter table public.companies
  add column if not exists invoice_igv boolean not null default false,   -- factura con IGV (tarifa x 1.18)
  add column if not exists t1_rate numeric;                                -- tarifa T1 pactada (ej. 9) si difiere de la general
