const SESSION_STORAGE_KEY = "lista-chequeo-session";

export const USERS = [
  {
    username: "jefe",
    password: "jefe",
    role: "jefe",
    label: "Jefe"
  },
  {
    username: "operario",
    password: "operario",
    role: "operario",
    label: "Operario"
  },
  {
    username: "auxiliar",
    password: "auxiliar",
    role: "auxiliar",
    label: "Auxiliar"
  }
];

export const ROLE_PERMISSIONS = {
  jefe: {
    canCreateChecklists: true,
    canEditRecords: true,
    canDownloadExcel: true
  },
  operario: {
    canCreateChecklists: true,
    canEditRecords: true,
    canDownloadExcel: false
  },
  auxiliar: {
    canCreateChecklists: false,
    canEditRecords: false,
    canDownloadExcel: true
  }
};

export function getPermissions(user) {
  return ROLE_PERMISSIONS[user?.role] ?? ROLE_PERMISSIONS.auxiliar;
}

export function authenticateUser(username, password) {
  const normalizedUsername = String(username ?? "").trim().toLowerCase();
  const user = USERS.find((item) =>
    item.username === normalizedUsername && item.password === String(password ?? "")
  );

  if (!user) {
    return null;
  }

  return {
    username: user.username,
    role: user.role,
    label: user.label
  };
}

export function loadSessionUser() {
  const storedSession = window.localStorage.getItem(SESSION_STORAGE_KEY);

  if (!storedSession) {
    return null;
  }

  try {
    const parsedSession = JSON.parse(storedSession);
    const user = USERS.find((item) => item.username === parsedSession.username);

    if (!user) {
      return null;
    }

    return {
      username: user.username,
      role: user.role,
      label: user.label
    };
  } catch {
    return null;
  }
}

export function saveSessionUser(user) {
  window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({
    username: user.username
  }));
}

export function clearSessionUser() {
  window.localStorage.removeItem(SESSION_STORAGE_KEY);
}
