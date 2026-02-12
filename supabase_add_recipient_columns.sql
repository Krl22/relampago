-- Agregar columnas recipient_name y recipient_phone a la tabla orders
-- Esto es necesario para que el repartidor sepa a quién entregar y llamar.

ALTER TABLE public.orders 
ADD COLUMN IF NOT EXISTS recipient_name text,
ADD COLUMN IF NOT EXISTS recipient_phone text;
