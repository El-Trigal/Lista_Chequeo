import { hasSupabaseConfig, supabase } from "./supabase";
import { DEFAULT_SEDE_ID } from "../data/sedes";

const LOCAL_STORAGE_KEY = "aspirado-checklist-records";
const TABLE_NAME = "aspirado_checklist_records";
const SYNC_PENDING = "pending";
const SYNC_SYNCED = "synced";

function readLocalRecords(sede) {
  const stored = readStoredValue(sede);

  if (!stored) {
    return [];
  }

  try {
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed)
      ? parsed.map((record) => ({
        ...record,
        syncStatus: record.syncStatus ?? SYNC_PENDING
      }))
      : [];
  } catch {
    return [];
  }
}

function getStorageKey(sede) {
  return `${LOCAL_STORAGE_KEY}::${sede}`;
}

// Los registros guardados antes de multisede vivian en la clave sin sufijo.
// La primera vez que la sede por defecto lee su clave nueva, se migran.
function readStoredValue(sede) {
  const stored = localStorage.getItem(getStorageKey(sede));

  if (stored !== null || sede !== DEFAULT_SEDE_ID) {
    return stored;
  }

  const legacyStored = localStorage.getItem(LOCAL_STORAGE_KEY);

  if (legacyStored === null) {
    return null;
  }

  localStorage.setItem(getStorageKey(sede), legacyStored);
  localStorage.removeItem(LOCAL_STORAGE_KEY);
  return legacyStored;
}

function writeLocalRecords(sede, records) {
  localStorage.setItem(getStorageKey(sede), JSON.stringify(records));
}

function getRecordTimestamp(record) {
  const timestamp = new Date(record.finishedAt ?? record.createdAt ?? 0).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function markRecordSynced(record) {
  return {
    ...record,
    syncStatus: SYNC_SYNCED,
    syncedAt: new Date().toISOString()
  };
}

function markRecordPending(record) {
  return {
    ...record,
    syncStatus: SYNC_PENDING
  };
}

function mapSupabaseRecord(row) {
  return {
    sede: row.sede,
    id: row.id,
    createdAt: row.created_at,
    finishedAt: row.finished_at,
    savedDate: row.saved_date,
    savedTime: row.saved_time,
    weekCode: row.week_code,
    form: row.form ?? {},
    score: Number(row.score ?? 0),
    percent: Number(row.percent ?? 0),
    summary: row.summary ?? { compliant: [], nonCompliant: [] },
    syncStatus: SYNC_SYNCED,
    syncedAt: row.finished_at ?? row.created_at
  };
}

function toSupabaseRow(sede, record) {
  return {
    sede,
    id: record.id,
    created_at: record.createdAt,
    finished_at: record.finishedAt,
    saved_date: record.savedDate,
    saved_time: record.savedTime,
    week_code: record.weekCode,
    form: record.form,
    score: record.score,
    percent: record.percent,
    summary: record.summary
  };
}

function mergeRecords(localRecords, remoteRecords) {
  const mergedById = new Map(remoteRecords.map((record) => [record.id, record]));

  for (const localRecord of localRecords) {
    const remoteRecord = mergedById.get(localRecord.id);

    if (
      localRecord.syncStatus === SYNC_PENDING ||
      (remoteRecord && getRecordTimestamp(localRecord) > getRecordTimestamp(remoteRecord))
    ) {
      mergedById.set(localRecord.id, localRecord);
    }
  }

  return [...mergedById.values()]
    .sort((left, right) => getRecordTimestamp(right) - getRecordTimestamp(left))
    .slice(0, 100);
}

function getSourceLabel(source, records) {
  const pendingCount = records.filter((record) => record.syncStatus === SYNC_PENDING).length;

  if (!pendingCount) {
    return source;
  }

  return `${source} (${pendingCount} pendiente${pendingCount === 1 ? "" : "s"})`;
}

async function pushRecordToSupabase(sede, record) {
  if (!hasSupabaseConfig || !supabase) {
    return false;
  }

  const { error } = await supabase.from(TABLE_NAME).upsert(toSupabaseRow(sede, record));

  if (error) {
    throw error;
  }

  return true;
}

export async function syncAspiradoRecords(sede) {
  const localRecords = readLocalRecords(sede);

  if (!hasSupabaseConfig || !supabase) {
    return localRecords;
  }

  let changed = false;
  const syncedRecords = [];

  for (const record of localRecords) {
    if (record.syncStatus !== SYNC_PENDING) {
      syncedRecords.push(record);
      continue;
    }

    try {
      await pushRecordToSupabase(sede, record);
      syncedRecords.push(markRecordSynced(record));
      changed = true;
    } catch {
      syncedRecords.push(record);
    }
  }

  if (changed) {
    writeLocalRecords(sede, syncedRecords);
  }

  return syncedRecords;
}

export async function loadAspiradoRecords(sede) {
  const localRecords = await syncAspiradoRecords(sede);

  if (hasSupabaseConfig && supabase) {
    try {
      const { data, error } = await supabase
        .from(TABLE_NAME)
        .select("*")
        .eq("sede", sede)
        .order("created_at", { ascending: false })
        .limit(100);

      if (!error && data) {
        const remoteRecords = data.map(mapSupabaseRecord);
        const mergedRecords = mergeRecords(localRecords, remoteRecords);
        writeLocalRecords(sede, mergedRecords);

        return {
          records: mergedRecords,
          sourceLabel: getSourceLabel("Supabase", mergedRecords)
        };
      }
    } catch {
      // Offline or network failures fall back to local records.
    }
  }

  return {
    records: localRecords,
    sourceLabel: getSourceLabel(hasSupabaseConfig ? "Local/Supabase pendiente" : "Local", localRecords)
  };
}

export async function saveAspiradoRecord(sede, record) {
  let localRecords = [markRecordPending(record), ...readLocalRecords(sede)].slice(0, 100);
  writeLocalRecords(sede, localRecords);

  try {
    await pushRecordToSupabase(sede, record);
    localRecords = localRecords.map((item) =>
      item.id === record.id ? markRecordSynced(item) : item
    );
    writeLocalRecords(sede, localRecords);
  } catch {
    // Local save remains pending until Supabase is reachable.
  }

  return localRecords;
}

export async function updateAspiradoRecord(sede, record) {
  const existingRecords = readLocalRecords(sede);
  const nextRecords = existingRecords.some((item) => item.id === record.id)
    ? existingRecords.map((item) => (item.id === record.id ? markRecordPending(record) : item))
    : [markRecordPending(record), ...existingRecords];

  let localRecords = nextRecords.slice(0, 100);
  writeLocalRecords(sede, localRecords);

  try {
    await pushRecordToSupabase(sede, record);
    localRecords = localRecords.map((item) =>
      item.id === record.id ? markRecordSynced(item) : item
    );
    writeLocalRecords(sede, localRecords);
  } catch {
    // Local edits remain pending until Supabase is reachable.
  }

  return localRecords;
}

export async function deleteAspiradoRecord(sede, recordId) {
  const existingRecords = readLocalRecords(sede);

  if (hasSupabaseConfig && supabase) {
    const { error } = await supabase.from(TABLE_NAME).delete().eq("id", recordId).eq("sede", sede);

    if (error) {
      throw error;
    }
  }

  const nextRecords = existingRecords.filter((record) => record.id !== recordId);
  writeLocalRecords(sede, nextRecords);
  return nextRecords;
}

