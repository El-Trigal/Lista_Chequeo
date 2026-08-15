import { hasSupabaseConfig, supabase } from "./supabase";
import { DEFAULT_SEDE_ID, isValidSede } from "../data/sedes";

// Cada usuario pertenece a UNA sola sede. Los emails deben existir en
// Supabase Auth y la asignacion de sede debe coincidir con la tabla
// `public.checklist_users` de `supabase/multisede.sql`: el frontend usa esta
// lista, pero quien realmente aisla los datos es RLS con esa tabla.
//
// Los usuarios de OL son los que ya existian y conservan sus emails; los de
// MT, FE y TR hay que crearlos en Supabase (Authentication > Users) con estos
// mismos emails.
const USER_PROFILES = [
  {
    username: "jefe",
    email: "jefemipe@trigal.com",
    role: "jefe",
    label: "jefe",
    sede: DEFAULT_SEDE_ID
  },
  {
    username: "operario",
    email: "operariomipe@trigal.com",
    role: "operario",
    label: "operario",
    sede: DEFAULT_SEDE_ID
  },
  {
    username: "auxiliar",
    email: "auxiliarpro@trigal.com",
    role: "auxiliar",
    label: "auxiliar",
    sede: DEFAULT_SEDE_ID
  },
  {
    username: "jefemt",
    email: "jefemt@trigal.com",
    role: "jefe",
    label: "jefe",
    sede: "mt"
  },
  {
    username: "operariomt",
    email: "operariomt@trigal.com",
    role: "operario",
    label: "operario",
    sede: "mt"
  },
  {
    username: "auxiliarmt",
    email: "auxiliarmt@trigal.com",
    role: "auxiliar",
    label: "auxiliar",
    sede: "mt"
  },
  {
    username: "jefefe",
    email: "jefefe@trigal.com",
    role: "jefe",
    label: "jefe",
    sede: "fe"
  },
  {
    username: "operariofe",
    email: "operariofe@trigal.com",
    role: "operario",
    label: "operario",
    sede: "fe"
  },
  {
    username: "auxiliarfe",
    email: "auxiliarfe@trigal.com",
    role: "auxiliar",
    label: "auxiliar",
    sede: "fe"
  },
  {
    username: "jefetr",
    email: "jefetr@trigal.com",
    role: "jefe",
    label: "jefe",
    sede: "tr"
  },
  {
    username: "operariotr",
    email: "operariotr@trigal.com",
    role: "operario",
    label: "operario",
    sede: "tr"
  },
  {
    username: "auxiliartr",
    email: "auxiliartr@trigal.com",
    role: "auxiliar",
    label: "auxiliar",
    sede: "tr"
  }
];

export const ROLE_PERMISSIONS = {
  jefe: {
    canCreateChecklists: true,
    canEditRecords: true,
    canDownloadExcel: true,
    canDeleteRecords: true
  },
  operario: {
    canCreateChecklists: true,
    canEditRecords: true,
    canDownloadExcel: false,
    canDeleteRecords: false
  },
  auxiliar: {
    canCreateChecklists: false,
    canEditRecords: false,
    canDownloadExcel: true,
    canDeleteRecords: false
  }
};

function normalizeLogin(value) {
  return String(value ?? "").trim().toLowerCase();
}

function getProfileByLogin(login) {
  const normalizedLogin = normalizeLogin(login);

  return USER_PROFILES.find((profile) =>
    profile.username === normalizedLogin || profile.email === normalizedLogin
  );
}

function getProfileByEmail(email) {
  const normalizedEmail = normalizeLogin(email);
  return USER_PROFILES.find((profile) => profile.email === normalizedEmail) ?? null;
}

function toSessionUser(profile, sessionUser) {
  return {
    id: sessionUser?.id ?? null,
    email: profile.email,
    username: profile.username,
    role: profile.role,
    label: profile.label,
    sede: profile.sede
  };
}

export function getPermissions(user) {
  return ROLE_PERMISSIONS[user?.role] ?? ROLE_PERMISSIONS.auxiliar;
}

export function getUserSede(user) {
  return isValidSede(user?.sede) ? user.sede : DEFAULT_SEDE_ID;
}

export async function authenticateUser(login, password) {
  if (!hasSupabaseConfig || !supabase) {
    throw new Error("Supabase no está configurado.");
  }

  const profile = getProfileByLogin(login);

  if (!profile) {
    throw new Error("Usuario no autorizado.");
  }

  const { data, error } = await supabase.auth.signInWithPassword({
    email: profile.email,
    password: String(password ?? "")
  });

  if (error) {
    throw new Error("Usuario o contraseña incorrectos.");
  }

  return toSessionUser(profile, data.user);
}

export async function loadSessionUser() {
  if (!hasSupabaseConfig || !supabase) {
    return null;
  }

  const { data, error } = await supabase.auth.getSession();

  if (error || !data.session?.user?.email) {
    return null;
  }

  const profile = getProfileByEmail(data.session.user.email);

  if (!profile) {
    await supabase.auth.signOut();
    return null;
  }

  return toSessionUser(profile, data.session.user);
}

export async function clearSessionUser() {
  if (hasSupabaseConfig && supabase) {
    await supabase.auth.signOut();
  }
}
