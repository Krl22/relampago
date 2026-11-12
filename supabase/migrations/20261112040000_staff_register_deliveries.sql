-- La central (admin / staff) puede registrar la prueba de entrega de un pedido, por ejemplo
-- cuando el motorizado no pudo subir la foto. Antes solo el propio motorizado podía insertar
-- en deliveries (courier_id = auth.uid()). La subida al bucket "proofs" ya estaba permitida.
drop policy if exists "staff_insert_deliveries" on public.deliveries;
create policy "staff_insert_deliveries" on public.deliveries
  for insert to authenticated
  with check (public.is_staff());
