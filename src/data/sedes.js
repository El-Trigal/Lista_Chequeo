// Catalogo de sedes. Fuente unica de verdad para toda la app.
//
// `id` es el valor que viaja a Supabase (columna `sede`) y a las claves de
// `localStorage`. NO cambiar un `id` despues de que haya registros guardados:
// habria que migrar la columna `sede` en las 8 tablas y las claves locales.
// `label` es el texto visible y se puede cambiar libremente.
export const SEDES = [
  { id: "sede1", label: "Sede 1" },
  { id: "sede2", label: "Sede 2" },
  { id: "sede3", label: "Sede 3" }
];

// Sede a la que pertenecen los registros creados antes de multisede.
export const DEFAULT_SEDE_ID = SEDES[0].id;

export const SEDE_IDS = SEDES.map((sede) => sede.id);

export function getSede(sedeId) {
  return SEDES.find((sede) => sede.id === sedeId) ?? null;
}

export function getSedeLabel(sedeId) {
  return getSede(sedeId)?.label ?? "";
}

export function isValidSede(sedeId) {
  return SEDE_IDS.includes(sedeId);
}
