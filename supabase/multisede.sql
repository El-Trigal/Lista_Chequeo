-- Multisede: aisla los registros de cada sede.
--
-- Pegar completo en el SQL Editor de Supabase. Es idempotente: se puede volver
-- a ejecutar sin romper nada.
--
-- ANTES DE EJECUTAR:
--   1. Crear en Authentication > Users los usuarios de las sedes nuevas, con
--      los mismos emails que estan en src/lib/auth.js.
--   2. Revisar el bloque "asignacion de usuarios" mas abajo: los emails y los
--      ids de sede deben coincidir exactamente con src/lib/auth.js.
--
-- Los registros que ya existen quedan asignados a 'ol' (la sede que venia
-- operando) por el default de la columna.
--
-- Las sedes son 4: ol, mt, fe, tr. Si una version anterior de este script ya
-- se ejecuto con los ids viejos ('sede1'), los pasos 3 y 4 renombran 'sede1' a
-- 'ol'; 'sede2' y 'sede3' no llegaron a usarse.

-- ---------------------------------------------------------------------------
-- 1. Mapa usuario -> sede
-- ---------------------------------------------------------------------------

create table if not exists public.checklist_users (
  user_id uuid primary key references auth.users (id) on delete cascade,
  sede text not null,
  created_at timestamptz not null default now()
);

alter table public.checklist_users enable row level security;

-- Cada usuario puede leer unicamente su propia fila.
drop policy if exists "checklist_users_select_self" on public.checklist_users;

create policy "checklist_users_select_self"
on public.checklist_users
for select
to authenticated
using (user_id = auth.uid());

grant select on public.checklist_users to authenticated;

-- Asignacion de usuarios. Ajustar emails e ids de sede segun src/lib/auth.js.
-- Los usuarios que no existan en auth.users simplemente no se insertan.
insert into public.checklist_users (user_id, sede)
select u.id, v.sede
from (values
  ('jefemipe@trigal.com',     'ol'),
  ('operariomipe@trigal.com', 'ol'),
  ('auxiliarpro@trigal.com',  'ol'),
  ('jefemt@trigal.com',       'mt'),
  ('operariomt@trigal.com',   'mt'),
  ('auxiliarmt@trigal.com',   'mt'),
  ('jefefe@trigal.com',       'fe'),
  ('operariofe@trigal.com',   'fe'),
  ('auxiliarfe@trigal.com',   'fe'),
  ('jefetr@trigal.com',       'tr'),
  ('operariotr@trigal.com',   'tr'),
  ('auxiliartr@trigal.com',   'tr')
) as v (email, sede)
join auth.users u on lower(u.email) = v.email
on conflict (user_id) do update set sede = excluded.sede;

-- ---------------------------------------------------------------------------
-- 2. Sede del usuario autenticado
-- ---------------------------------------------------------------------------

-- security definer para poder leer checklist_users sin depender de su RLS.
-- stable permite que Postgres la evalue una vez por consulta y no por fila.
create or replace function public.current_sede()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select sede
  from public.checklist_users
  where user_id = auth.uid();
$$;

revoke all on function public.current_sede() from public;
grant execute on function public.current_sede() to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Columna sede + indice en las 8 tablas
-- ---------------------------------------------------------------------------

do $$
declare
  target_table text;
  checklist_tables text[] := array[
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
  foreach target_table in array checklist_tables loop
    -- Los registros existentes quedan en 'ol' por el default.
    execute format(
      'alter table public.%I add column if not exists sede text not null default %L',
      target_table, 'ol'
    );

    -- Si la columna ya existia con el id viejo, se corrige el default y se
    -- renombra la sede de los registros que quedaron marcados como 'sede1'.
    execute format(
      'alter table public.%I alter column sede set default %L',
      target_table, 'ol'
    );

    execute format(
      'update public.%I set sede = %L where sede = %L',
      target_table, 'ol', 'sede1'
    );

    -- La app consulta siempre por sede ordenando por fecha.
    execute format(
      'create index if not exists %I on public.%I (sede, created_at desc)',
      target_table || '_sede_created_at_idx', target_table
    );
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Policies por sede
-- ---------------------------------------------------------------------------
-- Reemplaza los `using (true)` anteriores, que dejaban ver y editar los
-- registros de todas las sedes a cualquier usuario autenticado.

do $$
declare
  target_table text;
  checklist_tables text[] := array[
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
  foreach target_table in array checklist_tables loop
    execute format('alter table public.%I enable row level security', target_table);

    execute format('drop policy if exists %I on public.%I', target_table || '_select', target_table);
    execute format('drop policy if exists %I on public.%I', target_table || '_insert', target_table);
    execute format('drop policy if exists %I on public.%I', target_table || '_update', target_table);
    execute format('drop policy if exists %I on public.%I', target_table || '_delete', target_table);

    execute format(
      'create policy %I on public.%I for select to authenticated using (sede = public.current_sede())',
      target_table || '_select', target_table
    );

    execute format(
      'create policy %I on public.%I for insert to authenticated with check (sede = public.current_sede())',
      target_table || '_insert', target_table
    );

    execute format(
      'create policy %I on public.%I for update to authenticated using (sede = public.current_sede()) with check (sede = public.current_sede())',
      target_table || '_update', target_table
    );

    execute format(
      'create policy %I on public.%I for delete to authenticated using (sede = public.current_sede())',
      target_table || '_delete', target_table
    );
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Verificacion
-- ---------------------------------------------------------------------------
-- Asignacion de usuarios (deben aparecer las 12 filas si ya se crearon todos):
--   select u.email, c.sede
--   from public.checklist_users c
--   join auth.users u on u.id = c.user_id
--   order by c.sede, u.email;
--
-- Distribucion de registros por sede:
--   select sede, count(*) from public.spray_checklist_records group by sede;
--
-- Un usuario sin fila en checklist_users tendra current_sede() = null y no
-- vera ni podra guardar ningun registro. Es el comportamiento buscado: si se
-- crea un usuario nuevo hay que asignarle sede aqui.
