-- Agregar columna de teléfono a la tabla companies
ALTER TABLE public.companies 
ADD COLUMN IF NOT EXISTS phone text;
