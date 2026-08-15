# CLAUDE.md

Guia para Claude Code en este repositorio. Complementa `AGENTS.md` (que contiene
el detalle operativo del flujo de trabajo en Windows/PowerShell) y `README.md`
(configuracion de Supabase y despliegue).

## Que es este proyecto

App React 18 + Vite para digitalizar listas de chequeo operativas de finca
(aspersion de plaguicidas, monitoreos fitosanitarios, labores de aspirado y
soplado, cuarto frio). Funciona **offline-first**: todo se guarda primero en
`localStorage` y luego se sincroniza con Supabase si hay configuracion y red.
Se publica como sitio estatico en GitHub Pages.

Sin dependencias mas alla de `react`, `react-dom` y `@supabase/supabase-js`.
No hay router, ni framework de estado, ni tests, ni linter configurado.

## Comandos

```bash
npm install
npm run dev        # servidor Vite
npm run build      # validacion obligatoria tras cualquier cambio de codigo
npm run preview
```

En PowerShell (maquina del usuario) usar `npm.cmd` en vez de `npm` para evitar
el bloqueo de ejecucion de `npm.ps1`. En Linux/CI usar `npm` normal.

No hay suite de tests: **`npm run build` es la unica verificacion automatica**.
Ejecutarlo siempre antes de commitear.

## Arquitectura

### Composicion de la app

`src/main.jsx` monta `src/App.jsx`. `App.jsx` hace tres cosas:

1. Autenticacion (pantalla de login contra Supabase Auth).
2. Selector de modulo (`activeModule`): cada lista de chequeo es un componente
   raiz independiente que `App.jsx` renderiza en lugar de si mismo
   (`src/App.jsx:1242` en adelante).
3. La lista de aspersion propiamente dicha, que vive dentro de `App.jsx`.

Cada modulo maneja su propio estado con `useState` y alterna entre dos vistas:
`checklist` (formulario) y `records` (historico + filtros + export).

Modulos y su componente:

| Modulo | Componente |
| --- | --- |
| Aspersion de plaguicidas | `src/App.jsx` |
| Monitoreo roya blanca | `src/RbMonitoringApp.jsx` |
| Monitoreo directo | `src/DirectMonitoringApp.jsx` |
| TSWV | `src/TswvChecklistApp.jsx` |
| Aspirado | `src/AspiradoChecklistApp.jsx` |
| Soplado | `src/SopladoChecklistApp.jsx` |
| RB Bancos de enraizamiento | `src/RbRootingMonitoringApp.jsx` |
| Cuarto frio | `src/ColdRoomMonitoringApp.jsx` |

`src/RecordFilters.jsx` y `src/styles.css` son compartidos por todos.

### Capa de persistencia: `src/lib/*Records.js`

Hay un archivo por lista (`records.js` es el de aspersion; los demas siguen el
nombre del modulo). **Todos son casi identicos, ~245 lineas, con la misma
estructura** — al agregar una lista nueva se copia uno existente y se cambian
`LOCAL_STORAGE_KEY`, `TABLE_NAME` y los mapeos `toSupabaseRow` /
`mapSupabaseRecord`.

API exportada por cada uno: `sync*Records(sede)`, `load*Records(sede)`,
`save*Record(sede, record)`, `update*Record(sede, record)`,
`delete*Record(sede, recordId)`. **La sede siempre va primero.**

Contrato de comportamiento que hay que preservar:

1. Escribir/conservar siempre en `localStorage` primero.
2. Intentar sincronizar con Supabase solo si `hasSupabaseConfig`.
3. Cuando Supabase responde, mezclar los registros remotos (de todos los
   usuarios) con los locales.
4. Los registros que no se pudieron subir quedan con `syncStatus: "pending"` y
   se reintentan en la siguiente sincronizacion.
5. Toda lectura y escritura queda acotada a la sede: la clave local lleva
   sufijo `::<sede>` y las consultas remotas filtran por `.eq("sede", sede)`.

Mapa de claves locales a tablas (la clave real lleva sufijo `::<sede>`,
p. ej. `spray-checklist-records::ol`):

| localStorage | tabla Supabase |
| --- | --- |
| `spray-checklist-records` | `spray_checklist_records` |
| `rb-monitoring-checklist-records` | `rb_monitoring_records` |
| `direct-monitoring-checklist-records` | `direct_monitoring_records` |
| `tswv-checklist-records` | `tswv_checklist_records` |
| `aspirado-checklist-records` | `aspirado_checklist_records` |
| `soplado-checklist-records` | `soplado_checklist_records` |
| `rb-rooting-checklist-records` | `rb_rooting_records` |
| `cold-room-monitoring-records` | `cold_room_monitoring_records` |

`src/lib/records.js` filtra ademas por `RECORDS_RESET_AT`: los registros
anteriores a esa fecha se descartan al leer. No cambiar sin pedirlo el usuario.

Los registros guardados antes de multisede vivian en la clave sin sufijo, y los
de la primera version de multisede en `::sede1` (id que se reemplazo por `ol`);
la primera lectura de la sede por defecto los migra a la clave nueva.

### Multisede

La app opera 4 sedes (`ol`, `mt`, `fe`, `tr`) con **aislamiento total**: una
sede nunca ve los registros de otra. `ol` es la que ya venia operando: es
`DEFAULT_SEDE_ID` y a ella pertenecen los registros anteriores a multisede.

- `src/data/sedes.js` es el catalogo (`SEDES`, `DEFAULT_SEDE_ID`). Los `id`
  viajan a Supabase y a `localStorage`; **no cambiarlos** si ya hay registros.
- Cada usuario pertenece a una sola sede, declarada en `src/lib/auth.js` (12
  usuarios: 3 roles x 4 sedes). En los
  componentes la sede se deriva con `getUserSede(currentUser)`, no se pasa como
  prop desde `App.jsx`.
- El aislamiento real lo hace RLS, no la UI: `supabase/multisede.sql` crea
  `public.checklist_users` (usuario -> sede) y `public.current_sede()`, y las
  policies de las 8 tablas comparan `sede = public.current_sede()`. La lista de
  `auth.js` y esa tabla **tienen que coincidir**.
- Un usuario sin fila en `checklist_users` no ve ni guarda nada.
- Los planos de finca son por sede: ver `src/data/farmPlans.js`.

### Configuracion de las listas: `src/data/`

- `checklistConfig.js`: secciones, items y **pesos** de aspersion.
- `rbMonitoringConfig.js`, `directMonitoringConfig.js`: idem para esos modulos.
- `farmPlan.js` (~7.400 lineas): plano de bloques/naves/camas de la sede por
  defecto. **Archivo de datos sensible: no regenerarlo completo.** Hacer solo
  ediciones puntuales cuando el usuario indique una correccion concreta.
- `farmPlans.js`: registro de planos por sede. Es lo que consumen monitoreo
  directo y TSWV (`getFarmBlocks(sede)`, `getFarmNaves(sede, block)`,
  `getFarmBeds(sede, block, nave)`, `hasFarmPlan(sede)`). Para agregar el plano
  de una sede nueva se genera `farmPlanSedeN.js` desde su Excel y se registra
  ahi; mientras no exista, esos dos modulos muestran un aviso.

Los modulos mas nuevos llevan su configuracion inline en el propio `.jsx`.

### Calculos: `src/lib/checklistMath.js`

Reglas de negocio que se rompen facil si se tocan:

- Aspersion: calificacion = `(pesos cumplidos / 212) x 100`.
- Seccion de revision de aspersores: matriz por aspersor (presion 12, direccion
  36, tiempo 50 por repeticion, 294 puntos reales). El peso por repeticion se
  divide entre el numero de aspersores. El resultado se convierte por tramos:
  `>= 90% -> 90 pts`, `80-89% -> 60 pts`, `< 80% -> 30 pts`.
- Roya blanca, simulacros: si dispuestos = 0 y encontrados = 0 cuenta como 100%
  y 20/20.
- Cuarto frio, conformidad: 15 puntos = 5 canastillas x 3 bolsas, 1 punto por
  bolsa cumplida.

### Export a Excel: `src/lib/excelExport.js`

Genera archivos `.xlsx` **a mano**: construye el XML OOXML y arma el ZIP con una
implementacion propia de deflate/CRC32. No hay libreria de Excel. Cambiar este
archivo es delicado; preferir extender las funciones `download*RecordsExcel`
existentes en vez de tocar la maquinaria del ZIP.

Las funciones `download*RecordsExcel(sede, records)` reciben la sede y la usan
como prefijo del nombre del archivo. El contenido no la repite: con aislamiento
por sede, todas las filas del archivo son de una sola.

Aqui tambien vive el calculo de codigo de semana (`getCurrentWeekCode` y
variantes por tipo de registro), en formato `AASS` (ano corto + semana ISO).

Agrupaciones ya acordadas con el usuario en las hojas generadas:

- RB Bancos de enraizamiento: simulacros y reporte van bajo `REQUERIMIENTOS`.
- Cuarto frio: conformidad de la labor y reporte van bajo `REQUERIMIENTOS`.
- Soplado mantiene una estructura simple: rendimiento, requerimientos y calidad.

### Autenticacion y roles: `src/lib/auth.js`

Doce usuarios fijos con email quemado en el codigo (3 roles x 4 sedes),
autenticados contra Supabase Auth. Las contrasenas se configuran en Supabase y
**nunca van al repositorio**.

Rol y sede son dimensiones independientes: el rol da permisos
(`getPermissions`), la sede acota los datos (`getUserSede`).

| Rol | Crear | Editar | Excel | Eliminar |
| --- | --- | --- | --- | --- |
| `jefe` | si | si | si | si |
| `operario` | si | si | no | no |
| `auxiliar` | no | no | si | no |

Los permisos se leen con `getPermissions(user)`; agregar capacidades ahi, no en
condicionales sueltas dentro de los componentes.

### Supabase: `src/lib/supabase.js` y `supabase/*.sql`

El cliente es `null` cuando faltan variables — todo el codigo debe tolerarlo.
Variables aceptadas (Vite expone los dos prefijos, ver `vite.config.js`):

```text
VITE_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL
VITE_SUPABASE_ANON_KEY / VITE_SUPABASE_PUBLISHABLE_KEY / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
```

Los `.sql` de `supabase/` **no se ejecutan con el push**: el usuario los pega
manualmente en el SQL Editor de Supabase. Al agregar una tabla hay que dejar el
archivo SQL con RLS habilitado, policies para usuarios autenticados y, si
aplica, policy de delete para el rol correspondiente.
`auth-policies-and-retention.sql` implementa la limpieza automatica por limite
de almacenamiento (470 MB globales, minimo 100 registros por tabla).

## Como agregar una lista de chequeo nueva

1. `src/NombreApp.jsx` — componente raiz con vistas `checklist` y `records`.
2. `src/lib/nombreRecords.js` — copiar uno existente, cambiar clave local, tabla
   y mapeos. La sede va como primer parametro en las 5 funciones exportadas.
3. `supabase/nombre.sql` — tabla + RLS + policies. Incluir la columna
   `sede text not null`, el indice `(sede, created_at desc)` y policies con
   `sede = public.current_sede()`, como en `supabase/multisede.sql`.
4. `downloadNombreRecordsExcel` en `src/lib/excelExport.js`.
5. Registrar el modulo en el selector y el switch de `src/App.jsx`.
6. Estilos: reutilizar clases de `src/styles.css`.

## Convenciones de UI

- Paleta blanco / dorado / azul lapislazuli.
- Secciones plegables con flechas; tablas con bordes oscuros y legibles.
- Etiquetas visibles con genero neutro: `Monitor/a`, `Aspirador/a`,
  `Soplador/a`, `Asegurador/a`.
- Campos numericos: usar `sanitizeDecimalInput` de `src/lib/inputFormat.js`.
- Al **editar** un registro existente se conservan fecha, hora y semana
  originales de creacion.
- Ante dudas de layout en modo edicion/visualizacion, usar roya blanca como
  referencia: es el modulo cuyo diseno el usuario ya aprobo.

## Despliegue

`.github/workflows/deploy-pages.yml` construye y publica en GitHub Pages con
cada push a `main`. El workflow falla a proposito si faltan las variables de
Supabase; configurarlas en `Settings > Secrets and variables > Actions`.
`vite.config.js` fija `base` al nombre del repo solo cuando corre en Actions.

## Cuidados

- No commitear `.env.local` ni `dist/`.
- No borrar datos locales ni remotos sin solicitud explicita.
- No usar `git reset --hard` ni `git checkout --` sin permiso del usuario.
- El repositorio y la UI estan en espanol; mantener el idioma en codigo,
  mensajes de UI y commits.
