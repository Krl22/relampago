-- Preserve existing records and owner isolation, while restricting chat to current admins.
do $$
declare table_name text;
begin
  foreach table_name in array array['chat_conversations','chat_messages','chat_notes','chat_reports','chat_usage_calls'] loop
    execute format(
      'create policy chat_admin_only on public.%I as restrictive for all to authenticated
       using(exists(select 1 from public.profiles where id=(select auth.uid()) and role=''admin''))
       with check(exists(select 1 from public.profiles where id=(select auth.uid()) and role=''admin''))',table_name);
  end loop;
end;
$$;

-- Guard direct RPC calls as well as Edge calls. Keep the verified function bodies, signatures,
-- existing argument validation and grants; prepend only the current-role check.
do $$
declare fn record; viewer text; definition text; guarded text;
begin
  for fn in select oid,proname,proargnames from pg_proc where pronamespace='public'::regnamespace and proname in (
    'chat_order_summary','chat_usage_summary','chat_find_users','chat_user_activity',
    'chat_report_data','chat_authorize_report','chat_begin_turn','chat_service_order_summary','chat_telegram_confirm'
  ) loop
    if 'p_viewer_id'=any(fn.proargnames) then
      viewer:='case when current_user=''service_role'' then p_viewer_id else (select auth.uid()) end';
    elsif 'p_user_id'=any(fn.proargnames) then
      viewer:='p_user_id';
    else
      viewer:='(select auth.uid())';
    end if;
    definition:=pg_get_functiondef(fn.oid);
    guarded:=regexp_replace(definition,'\mbegin\M',
      'begin'||E'\n  if not exists(select 1 from public.profiles where id=('||viewer||') and role=''admin'') then'
      ||E'\n    raise exception ''assistant_admin_only'' using errcode=''42501'';'
      ||E'\n  end if;', 'i');
    if guarded=definition then raise exception 'Unable to guard function %',fn.proname;end if;
    execute guarded;
  end loop;
end;
$$;
notify pgrst,'reload schema';
