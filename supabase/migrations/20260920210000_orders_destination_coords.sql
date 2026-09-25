-- Coordenadas del punto de entrega, elegidas por el cliente en el formulario (pin arrastrable)
-- o corregidas por el admin. Base para el mapa admin y la ruta del motorizado.

alter table public.orders
  add column if not exists destination_lat double precision,
  add column if not exists destination_lng double precision;

alter table public.orders
  drop constraint if exists orders_destination_coords_check;
alter table public.orders
  add constraint orders_destination_coords_check check (
    (destination_lat is null and destination_lng is null)
    or (destination_lat between -90 and 90 and destination_lng between -180 and 180)
  );
