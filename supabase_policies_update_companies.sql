-- Habilitar lectura pública (anon) para la tabla companies
-- Esto es necesario para cargar la lista de empresas en el formulario público.
CREATE POLICY "Enable read access for all users" ON public.companies
FOR SELECT 
TO anon, authenticated
USING (true);

-- Asegurarse de que RLS esté activo
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
