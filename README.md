# MVP Listas de Chequeo

Aplicación React + Vite para digitalizar listas de chequeo de aspersión de plaguicidas y aseguramiento de monitoreo de roya blanca.

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

Ejecuta el SQL de [supabase/schema.sql](supabase/schema.sql) en el SQL Editor de Supabase. Crea estas tablas:

- `spray_checklist_records`
- `rb_monitoring_records`

Para un proyecto ya creado, ejecuta tambien [supabase/auth-policies-and-retention.sql](supabase/auth-policies-and-retention.sql). Ese script:

- Corrige las politicas RLS para que los usuarios de Supabase Auth puedan leer, guardar y editar registros.
- Activa una limpieza automatica que borra los registros mas antiguos cuando el total combinado de las dos tablas se acerca al limite configurado.
- Deja un limite inicial global de 470 MB para registros de listas y conserva minimo 100 registros por cada tabla.

El plan gratuito Nano de Supabase recomienda hasta 500 MB de base de datos. El limite global de 470 MB para registros de listas deja un margen pequeno para Auth, indices, metadatos y crecimiento interno de Postgres. La limpieza se basa en el tamano logico de los registros vivos; el tamano fisico de una tabla puede no bajar inmediatamente despues de borrar datos, pero ese espacio queda disponible para reutilizarse.

Puedes revisar el uso actual con esta consulta:

```sql
select * from public.get_checklist_storage_usage();
```

Para cambiar el limite, ajusta `max_total_live_bytes` en `public.checklist_storage_policy`.

### Usuarios

La app usa Supabase Auth. La app opera 3 sedes con aislamiento total; cada
usuario pertenece a una sola sede. Crea estos usuarios en `Authentication >
Users` (los emails deben coincidir exactamente con `src/lib/auth.js`):

| Email | Rol visual | Sede |
| --- | --- | --- |
| `jefemipe@trigal.com` | `jefe` | sede1 |
| `operariomipe@trigal.com` | `operario` | sede1 |
| `auxiliarpro@trigal.com` | `auxiliar` | sede1 |
| `jefesede2@trigal.com` | `jefe` | sede2 |
| `operariosede2@trigal.com` | `operario` | sede2 |
| `auxiliarsede2@trigal.com` | `auxiliar` | sede2 |
| `jefesede3@trigal.com` | `jefe` | sede3 |
| `operariosede3@trigal.com` | `operario` | sede3 |
| `auxiliarsede3@trigal.com` | `auxiliar` | sede3 |

Los usuarios de sede2 y sede3, y los nombres de sede (`Sede 1/2/3` en
`src/data/sedes.js`), son placeholders. Si los nombres reales de las sedes o
los emails van a ser distintos, avisar para actualizarlos ahi y en
`supabase/multisede.sql`.

Las contraseñas no se guardan en el repositorio; deben configurarse en Supabase.

## Multisede — pendientes de activación

El codigo de multisede ya esta en la rama (ver `CLAUDE.md`, seccion
"Multisede"), pero para que funcione en producción falta, en este orden:

1. **Crear en Supabase los 6 usuarios nuevos** (sede2 y sede3) listados arriba,
   en `Authentication > Users`.
2. **Pegar [`supabase/multisede.sql`](supabase/multisede.sql) en el SQL
   Editor de Supabase.** Agrega la columna `sede` a las 8 tablas, la tabla
   `checklist_users` (usuario → sede) con los 9 usuarios, la función
   `current_sede()` y reescribe las policies para que cada sede solo vea sus
   propios registros. Es idempotente, se puede volver a ejecutar sin romper
   nada. El archivo trae al final las consultas para verificar que quedó bien.
3. **Cargar los planos de bloques/naves/camas de sede2 y sede3.** Se necesita
   el Excel del plano de cada sede (mismo formato que el que ya se uso para
   `src/data/farmPlan.js`). Con eso se genera `src/data/farmPlanSede2.js` /
   `farmPlanSede3.js` y se registran en `src/data/farmPlans.js`. Mientras no
   esten cargados, monitoreo directo y TSWV muestran un aviso en vez de
   selectores de cama para esas sedes.

Sin el paso 2, el aislamiento entre sedes **no existe todavía**: las policies
de Supabase siguen siendo `using (true)`, es decir cualquier usuario
autenticado ve los registros de todas las sedes. La app funciona igual, pero
sin la separación real hasta que ese SQL se ejecute.

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
