// Planos de finca por sede.
//
// `farmPlan.js` es el plano de la sede 1 y NO se toca: es un archivo generado
// desde Excel, sensible, que no debe regenerarse completo (ver CLAUDE.md).
//
// Para agregar el plano de una sede nueva:
//   1. Generar `src/data/farmPlanSede2.js` desde el Excel de esa sede, con la
//      misma forma que `farmPlan.js`: { bloque: { nave: [camas] } }.
//   2. Importarlo aqui y registrarlo en `FARM_PLANS` bajo el id de la sede.
//
// Mientras una sede no tenga plano, `hasFarmPlan` devuelve false y los modulos
// que dependen del plano (monitoreo directo y TSWV) muestran un aviso en vez de
// selectores vacios.
import { FARM_PLAN } from "./farmPlan";
import { DEFAULT_SEDE_ID } from "./sedes";

const FARM_PLANS = {
  [DEFAULT_SEDE_ID]: FARM_PLAN
};

const collator = new Intl.Collator("es", { numeric: true, sensitivity: "base" });

function getPlan(sedeId) {
  return FARM_PLANS[sedeId] ?? null;
}

export function hasFarmPlan(sedeId) {
  const plan = getPlan(sedeId);
  return Boolean(plan && Object.keys(plan).length);
}

export function getFarmBlocks(sedeId) {
  const plan = getPlan(sedeId);
  return plan ? Object.keys(plan).sort(collator.compare) : [];
}

export function getFarmNaves(sedeId, block) {
  const plan = getPlan(sedeId);
  return Object.keys(plan?.[block] || {}).sort(collator.compare);
}

export function getFarmBeds(sedeId, block, nave) {
  const plan = getPlan(sedeId);
  return plan?.[block]?.[nave] || [];
}
