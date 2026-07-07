grant delete on public.spray_checklist_records to authenticated;
grant delete on public.rb_monitoring_records to authenticated;
grant delete on public.direct_monitoring_records to authenticated;
grant delete on public.tswv_checklist_records to authenticated;
grant delete on public.aspirado_checklist_records to authenticated;

drop policy if exists "spray_checklist_records_delete" on public.spray_checklist_records;
create policy "spray_checklist_records_delete"
on public.spray_checklist_records
for delete
to authenticated
using (true);

drop policy if exists "rb_monitoring_records_delete" on public.rb_monitoring_records;
create policy "rb_monitoring_records_delete"
on public.rb_monitoring_records
for delete
to authenticated
using (true);

drop policy if exists "direct_monitoring_records_delete" on public.direct_monitoring_records;
create policy "direct_monitoring_records_delete"
on public.direct_monitoring_records
for delete
to authenticated
using (true);

drop policy if exists "tswv_checklist_records_delete" on public.tswv_checklist_records;
create policy "tswv_checklist_records_delete"
on public.tswv_checklist_records
for delete
to authenticated
using (true);

drop policy if exists "aspirado_checklist_records_delete" on public.aspirado_checklist_records;
create policy "aspirado_checklist_records_delete"
on public.aspirado_checklist_records
for delete
to authenticated
using (true);
