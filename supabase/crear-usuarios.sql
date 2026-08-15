-- Crea usuarios de la app en Supabase Auth sin pasar por la interfaz de
-- Authentication > Users.
--
-- ESTADO: ejecutado el 15/08/2026; los 12 usuarios ya existen. El archivo se
-- conserva para agregar usuarios nuevos: se edita la lista de `values` de mas
-- abajo y se vuelve a ejecutar (los emails que ya existan se saltan).
--
-- ORDEN DE EJECUCION (en un proyecto desde cero):
--   1. Este archivo (crea los usuarios).
--   2. supabase/multisede.sql (columna sede, RLS y policies por sede).
--
-- Si `public.checklist_users` ya existe, este script tambien deja asignada la
-- sede de cada usuario que crea; si no existe todavia, la asignacion la hace
-- multisede.sql en el paso 2. Cualquiera de los dos ordenes termina igual.
--
-- ES IDEMPOTENTE: un email que ya exista en auth.users se salta sin tocarlo,
-- incluida su contrasena.
--
-- ---------------------------------------------------------------------------
-- ANTES DE EJECUTAR: CAMBIAR LAS CONTRASEÑAS
-- ---------------------------------------------------------------------------
-- Las contraseñas de abajo son de ejemplo. Reemplazarlas por las reales antes
-- de correr el script (minimo 6 caracteres; Supabase rechaza menos al iniciar
-- sesion). No commitear este archivo con las contraseñas reales adentro: si se
-- cambian aqui, revertir el archivo despues de ejecutarlo.

do $$
declare
  v_pgcrypto_schema text;
  v_user record;
  v_user_id uuid;
  v_created integer := 0;
  v_skipped integer := 0;
  v_has_checklist_users boolean;
begin
  -- pgcrypto vive en `extensions` en los proyectos nuevos de Supabase y en
  -- `public` en algunos viejos. Se resuelve el esquema real de crypt().
  select n.nspname
  into v_pgcrypto_schema
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where p.proname = 'crypt'
  limit 1;

  if v_pgcrypto_schema is null then
    raise exception
      'pgcrypto no esta instalado. Ejecutar primero: create extension if not exists pgcrypto with schema extensions;';
  end if;

  execute format('set local search_path = %I, public', v_pgcrypto_schema);

  select exists (
    select 1
    from information_schema.tables
    where table_schema = 'public' and table_name = 'checklist_users'
  ) into v_has_checklist_users;

  for v_user in
    select *
    from (values
      -- email                      sede   contraseña
      ('jefemt@trigal.com',         'mt',  'CambiarMT2026*'),
      ('operariomt@trigal.com',     'mt',  'CambiarMT2026*'),
      ('auxiliarmt@trigal.com',     'mt',  'CambiarMT2026*'),
      ('jefefe@trigal.com',         'fe',  'CambiarFE2026*'),
      ('operariofe@trigal.com',     'fe',  'CambiarFE2026*'),
      ('auxiliarfe@trigal.com',     'fe',  'CambiarFE2026*'),
      ('jefetr@trigal.com',         'tr',  'CambiarTR2026*'),
      ('operariotr@trigal.com',     'tr',  'CambiarTR2026*'),
      ('auxiliartr@trigal.com',     'tr',  'CambiarTR2026*')
    ) as t (email, sede, password)
  loop
    if exists (select 1 from auth.users u where lower(u.email) = v_user.email) then
      v_skipped := v_skipped + 1;
      raise notice 'Ya existia, no se toca: %', v_user.email;
      continue;
    end if;

    v_user_id := gen_random_uuid();

    -- email_confirmed_at en now() evita que el usuario tenga que confirmar el
    -- correo: son cuentas operativas, no hay buzon detras de esos emails.
    insert into auth.users (
      instance_id,
      id,
      aud,
      role,
      email,
      encrypted_password,
      email_confirmed_at,
      created_at,
      updated_at,
      raw_app_meta_data,
      raw_user_meta_data,
      confirmation_token,
      recovery_token,
      email_change,
      email_change_token_new
    ) values (
      '00000000-0000-0000-0000-000000000000',
      v_user_id,
      'authenticated',
      'authenticated',
      v_user.email,
      crypt(v_user.password, gen_salt('bf')),
      now(),
      now(),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{}'::jsonb,
      '',
      '',
      '',
      ''
    );

    -- Sin la fila en auth.identities el login con email/contraseña falla.
    -- Para el proveedor `email`, provider_id es el id del propio usuario.
    insert into auth.identities (
      id,
      provider_id,
      user_id,
      identity_data,
      provider,
      last_sign_in_at,
      created_at,
      updated_at
    ) values (
      gen_random_uuid(),
      v_user_id::text,
      v_user_id,
      jsonb_build_object(
        'sub', v_user_id::text,
        'email', v_user.email,
        'email_verified', true,
        'phone_verified', false
      ),
      'email',
      now(),
      now(),
      now()
    );

    if v_has_checklist_users then
      execute
        'insert into public.checklist_users (user_id, sede) values ($1, $2)
         on conflict (user_id) do update set sede = excluded.sede'
      using v_user_id, v_user.sede;
    end if;

    v_created := v_created + 1;
    raise notice 'Creado: % (sede %)', v_user.email, v_user.sede;
  end loop;

  raise notice 'Listo. Creados: %. Ya existian: %.', v_created, v_skipped;
end;
$$;

-- ---------------------------------------------------------------------------
-- Verificacion
-- ---------------------------------------------------------------------------
-- Deben aparecer los 12 usuarios (3 de OL + 9 nuevos), todos con identidad
-- `email` y correo confirmado:
--
--   select u.email,
--          u.email_confirmed_at is not null as confirmado,
--          i.provider
--   from auth.users u
--   left join auth.identities i on i.user_id = u.id
--   where u.email like '%@trigal.com'
--   order by u.email;

-- ---------------------------------------------------------------------------
-- Cambiar la contraseña de un usuario mas adelante
-- ---------------------------------------------------------------------------
-- Descomentar, ajustar email y contraseña, y ejecutar solo este bloque.
-- (Tambien se puede hacer desde Authentication > Users > el usuario.)
--
--   update auth.users
--   set encrypted_password = extensions.crypt('NuevaContraseña', extensions.gen_salt('bf')),
--       updated_at = now()
--   where lower(email) = 'jefemt@trigal.com';
