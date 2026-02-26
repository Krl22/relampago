-- Enable RLS on deliveries table
ALTER TABLE public.deliveries ENABLE ROW LEVEL SECURITY;

-- 1. Policy to allow Admin and Staff to view ALL deliveries
CREATE POLICY "Allow admin and staff to view all deliveries" ON public.deliveries
FOR SELECT
TO authenticated
USING (
  auth.uid() IN (
    SELECT id FROM public.profiles 
    WHERE role IN ('admin', 'staff')
  )
);

-- 2. Policy to allow Couriers to view ONLY their own deliveries
CREATE POLICY "Allow couriers to view own deliveries" ON public.deliveries
FOR SELECT
TO authenticated
USING (
  courier_id = auth.uid()
);

-- 3. Policy to allow Couriers to insert their own deliveries
CREATE POLICY "Allow couriers to insert deliveries" ON public.deliveries
FOR INSERT
TO authenticated
WITH CHECK (
  courier_id = auth.uid()
);

-- 4. Grant access to storage objects (proofs bucket) if not already set
-- Note: Storage policies are separate, but good to remind.
-- Assuming 'proofs' bucket exists and is public or has policies.
