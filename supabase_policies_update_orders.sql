-- Enable RLS on orders table if not already enabled
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

-- 1. Policy to allow Admin and Staff to update ALL orders
CREATE POLICY "Allow admin and staff to update orders" ON public.orders
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

-- 2. Policy to allow Couriers to update ONLY their assigned orders
CREATE POLICY "Allow couriers to update assigned orders" ON public.orders
FOR UPDATE
TO authenticated
USING (
  assigned_courier = auth.uid()
)
WITH CHECK (
  assigned_courier = auth.uid()
);

-- 3. Policy to allow Admin and Staff to insert orders (if not already present)
CREATE POLICY "Allow admin and staff to insert orders" ON public.orders
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() IN (
    SELECT id FROM public.profiles 
    WHERE role IN ('admin', 'staff')
  )
);

-- 4. Policy to allow Admin and Staff to delete orders (if not already present)
CREATE POLICY "Allow admin and staff to delete orders" ON public.orders
FOR DELETE
TO authenticated
USING (
  auth.uid() IN (
    SELECT id FROM public.profiles 
    WHERE role IN ('admin', 'staff')
  )
);

-- Ensure profiles are readable by everyone authenticated (needed for the subqueries above)
CREATE POLICY "Public profiles are viewable by everyone" ON public.profiles
FOR SELECT
TO authenticated
USING (true);
