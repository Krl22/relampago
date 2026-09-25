-- Nuevos estados de pedido. Van en su propia migración: un valor de enum recién
-- agregado no puede usarse dentro de la misma transacción que lo crea.
--   picked_up  el paquete ya fue recogido (o salió del almacén) y espera salir a ruta
--   failed     no se pudo entregar (nadie recibe, dirección errada, etc.)
--   cancelled  anulado por el cliente o por la central
alter type public.order_status add value if not exists 'picked_up';
alter type public.order_status add value if not exists 'failed';
alter type public.order_status add value if not exists 'cancelled';
