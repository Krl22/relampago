-- Permitir que usuarios anónimos (público) inserten nuevas empresas
-- Esto es para que si un cliente nuevo llena el formulario, su empresa se registre automáticamente.
CREATE POLICY "Enable insert for all users" ON public.companies
FOR INSERT 
TO anon, authenticated
WITH CHECK (true);
