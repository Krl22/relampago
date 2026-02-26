-- Permitir que usuarios Admin y Staff puedan gestionar perfiles (para crear motorizados)
-- 1. Asegurar RLS en profiles
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- 2. Permitir a todos ver perfiles (ya existe una policy, pero la reiteramos o mejoramos)
-- (Esta política es necesaria para que la UI funcione y se puedan asignar motorizados)
DROP POLICY IF EXISTS "Public profiles are viewable by everyone" ON public.profiles;
CREATE POLICY "Public profiles are viewable by everyone" ON public.profiles
FOR SELECT
TO authenticated
USING (true);

-- 3. Permitir a Admin y Staff insertar nuevos perfiles
-- Esto es crucial cuando se crea un usuario desde el panel de admin
CREATE POLICY "Allow admin and staff to insert profiles" ON public.profiles
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() IN (
    SELECT id FROM public.profiles 
    WHERE role IN ('admin', 'staff')
  )
);

-- 4. Permitir a Admin y Staff actualizar perfiles
CREATE POLICY "Allow admin and staff to update profiles" ON public.profiles
FOR UPDATE
TO authenticated
USING (
  auth.uid() IN (
    SELECT id FROM public.profiles 
    WHERE role IN ('admin', 'staff')
  )
)
WITH CHECK (
  auth.uid() IN (
    SELECT id FROM public.profiles 
    WHERE role IN ('admin', 'staff')
  )
);

-- 5. Permitir a Admin y Staff eliminar perfiles
CREATE POLICY "Allow admin and staff to delete profiles" ON public.profiles
FOR DELETE
TO authenticated
USING (
  auth.uid() IN (
    SELECT id FROM public.profiles 
    WHERE role IN ('admin', 'staff')
  )
);
