-- Agregar columnas para gestión logística a la tabla orders
ALTER TABLE public.orders 
ADD COLUMN IF NOT EXISTS payment_method text, -- 'Motorizado', 'Directo a comercio', 'Relampago Courier'
ADD COLUMN IF NOT EXISTS tariff text, -- 'T1', 'T2', 'T3'
ADD COLUMN IF NOT EXISTS total_amount numeric,
ADD COLUMN IF NOT EXISTS delivery_notes text,
ADD COLUMN IF NOT EXISTS delivered_at timestamptz;
