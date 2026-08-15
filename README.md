# MVP Listas de Chequeo

Aplicación React + Vite para digitalizar las listas de chequeo operativas de
finca: aspersión de plaguicidas, monitoreos fitosanitarios (roya blanca,
monitoreo directo, TSWV, bancos de enraizamiento), labores de aspirado y
soplado, y cuarto frío. Funciona offline-first (`localStorage` primero,
Supabase después) y opera 4 sedes con aislamiento total entre ellas.

## Stack

- React 18
- Vite
- `localStorage` como respaldo local
- Supabase JS para guardar registros remotos
- GitHub Pages para publicación estática

## Ejecutar en local

```powershell
npm.cmd install
npm.cmd run dev
```

## Supabase

El MVP funciona sin Supabase, pero si existen variables de entorno guarda y carga registros desde Supabase. Para local, crea `.env.local` basado en `.env.example`:

```text
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

También acepta nombres compatibles con Next:

```text
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...
```

Ningun `.sql` de `supabase/` se ejecuta con el push: se pegan a mano en el SQL
Editor de Supabase. Para montar el proyecto desde cero, en este orden:

| Archivo | Que hace |
| --- | --- |
| [`schema.sql`](supabase/schema.sql) | Tablas de aspersion, roya blanca y monitoreo directo |
| [`tswv-and-aspirado-checklist-records.sql`](supabase/tswv-and-aspirado-checklist-records.sql) | Tablas de TSWV y aspirado |
| [`soplado-checklist-records.sql`](supabase/soplado-checklist-records.sql) | Tabla de soplado |
| [`rb-rooting-records.sql`](supabase/rb-rooting-records.sql) | Tabla de bancos de enraizamiento |
| [`cold-room-monitoring-records.sql`](supabase/cold-room-monitoring-records.sql) | Tabla de cuarto frio |
| [`auth-policies-and-retention.sql`](supabase/auth-policies-and-retention.sql) | RLS para usuarios de Supabase Auth + limpieza por limite de almacenamiento |
| [`delete-record-policies.sql`](supabase/delete-record-policies.sql) | Policies de borrado |
| [`crear-usuarios.sql`](supabase/crear-usuarios.sql) | Crea los usuarios en `auth.users` |
| [`multisede.sql`](supabase/multisede.sql) | Columna `sede`, `checklist_users`, `current_sede()` y policies por sede |

Las 8 tablas de registros son:

| Modulo | Tabla |
| --- | --- |
| Aspersion de plaguicidas | `spray_checklist_records` |
| Monitoreo roya blanca | `rb_monitoring_records` |
| Monitoreo directo | `direct_monitoring_records` |
| TSWV | `tswv_checklist_records` |
| Aspirado | `aspirado_checklist_records` |
| Soplado | `soplado_checklist_records` |
| RB bancos de enraizamiento | `rb_rooting_records` |
| Cuarto frio | `cold_room_monitoring_records` |

`auth-policies-and-retention.sql` ademas:

- Activa una limpieza automatica que borra los registros mas antiguos cuando el total combinado de las tablas se acerca al limite configurado.
- Deja un limite inicial global de 470 MB para registros de listas y conserva minimo 100 registros por cada tabla.

El plan gratuito Nano de Supabase recomienda hasta 500 MB de base de datos. El limite global de 470 MB para registros de listas deja un margen pequeno para Auth, indices, metadatos y crecimiento interno de Postgres. La limpieza se basa en el tamano logico de los registros vivos; el tamano fisico de una tabla puede no bajar inmediatamente despues de borrar datos, pero ese espacio queda disponible para reutilizarse.

Puedes revisar el uso actual con esta consulta:

```sql
select * from public.get_checklist_storage_usage();
```

Para cambiar el limite, ajusta `max_total_live_bytes` en `public.checklist_storage_policy`.

### Usuarios

La app usa Supabase Auth y opera 4 sedes (OL, MT, FE y TR) con aislamiento
total; cada usuario pertenece a una sola sede. Los 12 usuarios ya estan creados
en Supabase. Los emails deben coincidir exactamente con `src/lib/auth.js`:

| Email | Rol visual | Sede |
| --- | --- | --- |
| `jefemipe@trigal.com` | `jefe` | OL |
| `operariomipe@trigal.com` | `operario` | OL |
| `auxiliarpro@trigal.com` | `auxiliar` | OL |
| `jefemt@trigal.com` | `jefe` | MT |
| `operariomt@trigal.com` | `operario` | MT |
| `auxiliarmt@trigal.com` | `auxiliar` | MT |
| `jefefe@trigal.com` | `jefe` | FE |
| `operariofe@trigal.com` | `operario` | FE |
| `auxiliarfe@trigal.com` | `auxiliar` | FE |
| `jefetr@trigal.com` | `jefe` | TR |
| `operariotr@trigal.com` | `operario` | TR |
| `auxiliartr@trigal.com` | `auxiliar` | TR |

OL es la sede que ya venia operando: conserva sus 3 usuarios originales y todos
los registros anteriores a multisede quedaron asignados a ella. Los 9 de MT, FE
y TR se crearon con
[`supabase/crear-usuarios.sql`](supabase/crear-usuarios.sql), que inserta en
`auth.users` y `auth.identities` con el correo ya confirmado y se salta los
emails que ya existan. Ese mismo script sirve para agregar un usuario nuevo mas
adelante: se edita la lista de `values`, se ejecuta, y al final trae un bloque
comentado para cambiar contraseñas.

Las contraseñas no se guardan en el repositorio; se configuran en Supabase. Las
que trae el script son de ejemplo y hay que reemplazarlas antes de ejecutarlo
(y no dejarlas escritas en el archivo despues).

## Multisede

El aislamiento por sede esta **activo en produccion** desde el 15 de agosto de
2026. Lo que hay montado, para referencia:

- Los 12 usuarios existen en Supabase Auth, cada uno con su fila en
  `public.checklist_users` (usuario → sede).
- Las 8 tablas de registros tienen columna `sede`, indice `(sede, created_at
  desc)` y policies RLS que comparan `sede = public.current_sede()`.
- Los 150 registros que existian antes de multisede quedaron asignados a OL.
- Quien aisla los datos es RLS, no la interfaz: un usuario sin fila en
  `checklist_users` no ve ni guarda nada.

Los dos scripts que dejaron esto montado son idempotentes y se pueden volver a
ejecutar sin romper nada:
[`supabase/crear-usuarios.sql`](supabase/crear-usuarios.sql) (usuarios) y
[`supabase/multisede.sql`](supabase/multisede.sql) (columna, funcion y
policies). El segundo trae al final las consultas de verificacion.

Al agregar una sede nueva hay que tocar, en este orden: `src/data/sedes.js`,
`src/lib/auth.js`, la lista de `values` de los dos `.sql`, y el plano en
`src/data/farmPlans.js`.

## Pendientes

**Planos de bloques/naves/camas de MT, FE y TR.** Es lo unico que falta. Se
necesita el Excel del plano de cada sede, con el mismo formato que el que ya se
uso para `src/data/farmPlan.js` (que es el de OL). Con eso se generan
`src/data/farmPlanMt.js`, `farmPlanFe.js` y `farmPlanTr.js` y se registran en
`src/data/farmPlans.js`.

Mientras no esten cargados, esas tres sedes funcionan en todos los modulos
menos **monitoreo directo** y **TSWV**, que necesitan el plano para los
selectores de cama y muestran un aviso en su lugar. OL no se ve afectada.

## GitHub Pages

El workflow está en `.github/workflows/deploy-pages.yml`. En el repositorio de GitHub configura estos secretos en `Settings > Secrets and variables > Actions`:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
```

También puedes usar `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`.

Después de hacer push a `main`, GitHub Actions construye la app y la publica en GitHub Pages.

La calificación de aspersión se calcula como:

```text
(total de pesos cumplidos / 212) x 100
```

## Pesos por confirmar

Los pesos estan centralizados en `src/data/checklistConfig.js`.

La seccion de revision de aspersores usa un calculo especial:

- Presion: 12 puntos por repeticion.
- Direccion: 36 puntos por repeticion.
- Tiempo: 50 puntos por repeticion.
- Total real evaluado: 294 puntos.
- Si hay varios aspersores, cada peso por repeticion se divide entre el numero de aspersores.
- Si el cumplimiento real es >= 90%, la seccion aporta 90 puntos a la calificacion.
- Si esta entre 80% y 89%, aporta 60 puntos.
- Si es menor a 79%, aporta 30 puntos.
