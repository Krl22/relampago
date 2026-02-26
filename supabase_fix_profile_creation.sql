-- FIX: Asegurar que el propio usuario (o un trigger) pueda crear su perfil inicial
-- A veces, cuando se crea un usuario con signUp, Supabase intenta insertar en profiles automáticamente si hay un trigger.
-- Si no hay trigger, nuestra app intenta insertar.
-- La policy anterior solo permitía a 'admin' o 'staff' insertar, pero al momento de la inserción,
-- si lo hace el trigger, actúa con los permisos del usuario recién creado (que aún no es admin ni staff).

-- Opción A: Crear un trigger para manejar la creación de perfil automáticamente (Recomendado)
-- Esto evita problemas de permisos desde el cliente.

CREATE OR REPLACE FUNCTION public.handle_new_user() 
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, role)
  VALUES (
    new.id, 
    new.raw_user_meta_data->>'full_name', 
    COALESCE(new.raw_user_meta_data->>'role', 'client')::public.user_role
  );
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- SECURITY DEFINER hace que la función se ejecute con permisos de superusuario, saltándose RLS.

-- Trigger para ejecutar la función cada vez que se crea un usuario en auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- Opción B: Si prefieres mantener la lógica en el cliente, necesitamos permitir que CUALQUIER usuario autenticado inserte SU PROPIO perfil.
-- (Pero el trigger es mucho más robusto).

-- Además, aseguramos que los admins puedan ACTUALIZAR cualquier perfil (ya cubierto en la policy anterior).
