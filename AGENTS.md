# AGENTS.md

Instrucciones para agentes que trabajen en este proyecto.

## Proyecto

App React + Vite para listas de chequeo operativas, con soporte offline-first en
`localStorage`, sincronizacion con Supabase y despliegue por GitHub Pages.

Ruta local:

```powershell
C:\Users\HP\Documents\mvp-checklist-aspersion
```

## Stack y comandos

- React 18 + Vite.
- Supabase JS v2.
- Publicacion estatica por GitHub Pages.
- Comandos principales:

```powershell
npm.cmd install
npm.cmd run dev
npm.cmd run build
npm.cmd run preview
```

Usar siempre `npm.cmd` en PowerShell para evitar el bloqueo de ejecucion de
scripts de `npm.ps1`.

## Estructura importante

- `src/App.jsx`: modulo principal, inicio, navegacion y lista de aspersion.
- `src/RbMonitoringApp.jsx`: Aseguramiento de monitoreo roya blanca.
- `src/DirectMonitoringApp.jsx`: Aseguramiento de monitoreo directo.
- `src/TswvChecklistApp.jsx`: Aseguramiento TSWV.
- `src/AspiradoChecklistApp.jsx`: Aseguramiento de aspirado.
- `src/styles.css`: estilos globales de todas las listas.
- `src/RecordFilters.jsx`: filtros de registros.
- `src/data/checklistConfig.js`: configuracion de aspersion.
- `src/data/rbMonitoringConfig.js`: configuracion de roya blanca.
- `src/data/directMonitoringConfig.js`: configuracion de monitoreo directo.
- `src/data/farmPlan.js`: plano de bloques, naves y camas usado por directo y
  TSWV.
- `src/lib/excelExport.js`: exportaciones a Excel.
- `src/lib/auth.js`: roles visuales y permisos de la app.
- `src/lib/*Records.js`: persistencia offline-first y sincronizacion Supabase.
- `src/lib/supabase.js`: cliente Supabase y variables de entorno.
- `supabase/*.sql`: esquemas, politicas RLS y funciones de mantenimiento.
- `.github/workflows/deploy-pages.yml`: build y deploy a GitHub Pages.

## Roles y permisos

Los permisos visibles se controlan en `src/lib/auth.js`.

- `jefe`: puede crear chequeos, ver registros, editar, eliminar y descargar
  Excel.
- `operario`: puede crear chequeos, ver registros y editar; no descarga Excel
  ni elimina.
- `auxiliar`: puede ver registros, entrar en modo visualizacion y descargar
  Excel; no crea ni edita.

No guardar contrasenas en el repositorio.

## Supabase

La app debe seguir funcionando localmente aunque Supabase no este disponible.
El patron esperado en cada `src/lib/*Records.js` es:

1. Guardar o conservar datos localmente.
2. Intentar sincronizar con Supabase si hay configuracion y red.
3. Mostrar tambien registros remotos de todos los usuarios cuando Supabase esta
   disponible.
4. Mantener registros pendientes si no se pudieron sincronizar.

Variables aceptadas:

```text
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
VITE_SUPABASE_PUBLISHABLE_KEY
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
```

Cuando se agregue una lista nueva con registros remotos, crear tambien:

- Un archivo `src/lib/nombreRecords.js`.
- SQL en `supabase/nombre.sql`.
- Tabla con RLS habilitado.
- Policies para usuarios autenticados.
- Si aplica, policy de delete para el rol correspondiente.

Los SQL no se ejecutan con el push; el usuario debe pegarlos en Supabase SQL
Editor.

## Reglas de edicion

Antes de editar:

```powershell
git status --short
rg -n "texto a buscar" src
```

Este proyecto tiene archivos JSX compactos y PowerShell puede colgarse con
comandos largos. Preferir cambios pequenos y verificables.

Metodo recomendado para cambios simples o medianos:

1. Buscar con `rg`.
2. Crear script temporal Python pequeno.
3. Ejecutar con `py -3.11`.
4. Borrar el script temporal.
5. Verificar con `rg`.
6. Ejecutar `npm.cmd run build`.
7. Revisar `git diff`.

Ejemplo:

```powershell
@'
from pathlib import Path
p = Path('src/Archivo.jsx')
s = p.read_text(encoding='utf-8-sig')
s = s.replace('texto viejo', 'texto nuevo')
p.write_text(s, encoding='utf-8')
print('ok')
'@ | Set-Content -Encoding UTF8 __patch_temp.py
py -3.11 __patch_temp.py
Remove-Item __patch_temp.py
```

Evitar:

- Comandos enormes en una sola linea.
- `cmd /c py -c` con JSX, tildes, backticks o muchas comillas.
- Mezclar busqueda, edicion, build y git en un solo comando.
- `git reset --hard` o `git checkout --` sin permiso explicito.

## Validacion obligatoria

Despues de cambios de codigo:

```powershell
npm.cmd run build
git status --short
git diff --stat
```

Si el usuario pide push:

```powershell
git add <archivos>
git commit -m "Mensaje claro"
git push origin main
```

Si GitHub Actions falla por variables de Supabase, revisar secretos/variables de
Actions:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
```

## Cuidado con archivos generados o sensibles

- No subir `.env.local`.
- No borrar datos locales o remotos salvo solicitud explicita.
- `src/data/farmPlan.js` es un archivo de datos sensible para seleccion de
  bloque/nave/cama. No regenerarlo completo sin confirmacion; preferir cambios
  puntuales cuando el usuario indique una correccion especifica.
- `dist/` puede existir localmente por build; no asumir que necesita commit.

## Criterios de UI

- Mantener la paleta blanco, dorado y azul lapis lazuli.
- Mantener secciones plegables con flechas.
- Mantener tablas legibles con bordes oscuros.
- En modo edicion/visualizacion, conservar la ubicacion y estilo ya aceptados
  por el usuario, usando roya blanca como referencia cuando haya dudas.
- Los campos numericos deben aceptar solo numeros decimales cuando aplique.
- Al editar un registro existente, conservar la fecha, hora y semana originales
  de creacion.

## Notas funcionales

- Aspersion calcula calificacion como `(total pesos cumplidos / 212) x 100`.
- Revision de asperjadores usa puntaje especial por presion, direccion y tiempo.
- Roya blanca, seccion simulacros: si dispuestos = 0 y encontrados = 0, debe
  contar como 100% y 20/20.
- Monitoreo directo usa `src/data/farmPlan.js` para camas por nave.
- Las exportaciones a Excel estan centralizadas en `src/lib/excelExport.js`.

