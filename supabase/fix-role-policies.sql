-- ============================================================================
-- fix-role-policies.sql
--
-- Corrige la validacion de roles en RLS.
--
-- PROBLEMA: delete-record-policies.sql creo policies DELETE con using (true),
-- permitiendo que cualquier usuario autenticado elimine registros de cualquier
-- sede. auth-policies-and-retention.sql hizo lo mismo para SELECT/INSERT/UPDATE
-- en 3 tablas. multisede.sql aislaba por sede pero no por rol.
--
-- SOLUCION:
--   SELECT  -> cualquier rol, solo su sede.
--   INSERT  -> jefe u operario, solo su sede.
--   UPDATE  -> jefe u operario, solo su sede.
--   DELETE  -> solo jefe, solo su sede.
--
-- Idempotente: se puede ejecutar varias veces sin romper nada.
-- Compatible con los grants existentes.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. Agregar columna 'role' a checklist_users (si no existe)
-- ---------------------------------------------------------------------------

alter table public.checklist_users
  add column if not exists role text not null default 'auxiliar';


-- ---------------------------------------------------------------------------
-- 2. Poblar roles segun src/lib/auth.js
--    Los emails deben coincidir con los de Authentication > Users.
--    Re-ejecutar este bloque si cambian usuarios.
-- ---------------------------------------------------------------------------

update public.checklist_users cu
set role = v.role
from (values
  ('jefemipe@trigal.com',     'jefe'),
  ('operariomipe@trigal.com', 'operario'),
  ('auxiliarpro@trigal.com',  'auxiliar'),
  ('jefemt@trigal.com',       'jefe'),
  ('operariomt@trigal.com',   'operario'),
  ('auxiliarmt@trigal.com',   'auxiliar'),
  ('jefefe@trigal.com',       'jefe'),
  ('operariofe@trigal.com',   'operario'),
  ('auxiliarfe@trigal.com',   'auxiliar'),
  ('jefetr@trigal.com',       'jefe'),
  ('operariotr@trigal.com',   'operario'),
  ('auxiliartr@trigal.com',   'auxiliar')
) as v (email, role)
join auth.users u on lower(u.email) = v.email
where cu.user_id = u.id;


-- ---------------------------------------------------------------------------
-- 3. Funcion: rol del usuario autenticado
--    NOTA: 'current_role' esta reservado por PostgreSQL; se usa 'checklist_role'.
--    security definer para leer checklist_users sin depender de su RLS.
-- ---------------------------------------------------------------------------

create or replace function public.checklist_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role
  from public.checklist_users
  where user_id = auth.uid();
$$;

revoke all on function public.checklist_role() from public;
grant execute on function public.checklist_role() to authenticated;


-- ---------------------------------------------------------------------------
-- 4. Reemplazar todas las policies de las 8 tablas
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
  tables text[] := array[
    'spray_checklist_records',
    'rb_monitoring_records',
    'direct_monitoring_records',
    'tswv_checklist_records',
    'aspirado_checklist_records',
    'soplado_checklist_records',
    'rb_rooting_records',
    'cold_room_monitoring_records'
  ];
begin
  foreach t in array tables loop

    execute format('alter table public.%I enable row level security', t);

    -- DROP de todas las policies existentes (cubren los nombres de multisede.sql,
    -- auth-policies-and-retention.sql y delete-record-policies.sql)
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);

    -- SELECT: todos los roles, solo su sede
    execute format(
      'create policy %I on public.%I
       for select to authenticated
       using (sede = public.current_sede())',
      t || '_select', t
    );

    -- INSERT: jefe u operario, solo su sede
    execute format(
      'create policy %I on public.%I
       for insert to authenticated
       with check (
         sede = public.current_sede()
         and public.checklist_role() in (''jefe'', ''operario'')
       )',
      t || '_insert', t
    );

    -- UPDATE: jefe u operario, solo su sede
    execute format(
      'create policy %I on public.%I
       for update to authenticated
       using (sede = public.current_sede())
       with check (
         sede = public.current_sede()
         and public.checklist_role() in (''jefe'', ''operario'')
       )',
      t || '_update', t
    );

    -- DELETE: solo jefe, solo su sede
    execute format(
      'create policy %I on public.%I
       for delete to authenticated
       using (
         sede = public.current_sede()
         and public.checklist_role() = ''jefe''
       )',
      t || '_delete', t
    );

  end loop;
end;
$$;


-- ---------------------------------------------------------------------------
-- 5. Verificacion (ejecutar por separado para confirmar el resultado)
-- ---------------------------------------------------------------------------
--
-- 5a. Policies activas — cada DELETE debe tener checklist_role() = 'jefe',
--     cada INSERT/UPDATE debe tener checklist_role() IN ('jefe','operario'),
--     cada SELECT solo debe tener sede = current_sede():
--
-- select tablename, policyname, cmd, qual, with_check
-- from pg_policies
-- where schemaname = 'public'
--   and tablename like '%records%'
-- order by tablename, cmd;
--
--
-- 5b. Roles asignados — deben aparecer 12 filas con role correcto:
--
-- select u.email, c.sede, c.role
-- from public.checklist_users c
-- join auth.users u on u.id = c.user_id
-- order by c.sede, c.role;
--
--
-- 5c. Prueba funcional desde un usuario operario autenticado:
--     DELETE from public.spray_checklist_records where id = '<id_de_prueba>';
--     Debe devolver: "new row violates row-level security policy"
--     o simplemente 0 filas afectadas (Supabase no expone el mensaje de RLS).
