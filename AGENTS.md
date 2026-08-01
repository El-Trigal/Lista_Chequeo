# AGENTS.md

Instrucciones para agentes que trabajen en este proyecto.

**La guia completa esta en [`CLAUDE.md`](CLAUDE.md)**: que es la app,
arquitectura, capa de persistencia offline-first, reglas de calculo, roles y
permisos, Supabase, convenciones de UI, como agregar una lista nueva y
despliegue. Leerlo primero. Este archivo solo agrega lo especifico del entorno
Windows/PowerShell del usuario, para no duplicar informacion que se
desincroniza.

## Entorno local del usuario

Ruta del repositorio:

```powershell
C:\Users\HP\Documents\mvp-checklist-aspersion
```

Usar siempre `npm.cmd` en PowerShell para evitar el bloqueo de ejecucion de
scripts de `npm.ps1`. En Linux/CI usar `npm` normal.

```powershell
npm.cmd install
npm.cmd run dev
npm.cmd run build
npm.cmd run preview
```

## Metodo de edicion en PowerShell

Este proyecto tiene archivos JSX compactos y PowerShell puede colgarse con
comandos largos. Preferir cambios pequenos y verificables.

Antes de editar:

```powershell
git status --short
rg -n "texto a buscar" src
```

Metodo recomendado para cambios simples o medianos:

1. Buscar con `rg`.
2. Crear un script temporal Python pequeno.
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

No hay suite de tests: `npm.cmd run build` es la unica verificacion automatica.
Despues de cualquier cambio de codigo:

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

`dist/` puede existir localmente por build; no asumir que necesita commit.
