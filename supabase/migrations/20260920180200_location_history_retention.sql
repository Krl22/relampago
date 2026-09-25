-- Limpieza diaria del historial de ubicaciones (retención: 7 días).
-- Va en su propia migración: si pg_cron no estuviera disponible, el resto ya quedó aplicado.

create extension if not exists pg_cron;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'purge_courier_location_history') then
    perform cron.unschedule('purge_courier_location_history');
  end if;

  perform cron.schedule(
    'purge_courier_location_history',
    '0 8 * * *',   -- 08:00 UTC = 03:00 Lima
    $job$ delete from public.courier_location_history where recorded_at < now() - interval '7 days' $job$
  );
end;
$$;
