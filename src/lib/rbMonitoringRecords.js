import { hasSupabaseConfig, supabase } from "./supabase";

const LOCAL_STORAGE_KEY = "rb-monitoring-checklist-records";
const TABLE_NAME = "rb_monitoring_records";

function readLocalRecords() {
  const stored = localStorage.getItem(LOCAL_STORAGE_KEY);

  if (!stored) {
    return [];
  }

  try {
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLocalRecords(records) {
  localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(records));
}

function mapSupabaseRecord(row) {
  return {
    id: row.id,
    createdAt: row.created_at,
    finishedAt: row.finished_at,
    savedDate: row.saved_date,
    savedTime: row.saved_time,
    weekCode: row.week_code,
    form: row.form ?? {},
    score: Number(row.score ?? 0),
    percent: Number(row.percent ?? 0),
    summary: row.summary ?? { compliant: [], nonCompliant: [] }
  };
}

export async function loadRbMonitoringRecords() {
  if (hasSupabaseConfig && supabase) {
    const { data, error } = await supabase
      .from(TABLE_NAME)
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);

    if (!error && data) {
      return {
        records: data.map(mapSupabaseRecord),
        sourceLabel: "Supabase"
      };
    }
  }

  return {
    records: readLocalRecords(),
    sourceLabel: "Local"
  };
}

export async function saveRbMonitoringRecord(record) {
  const nextRecords = [record, ...readLocalRecords()].slice(0, 100);
  writeLocalRecords(nextRecords);

  if (hasSupabaseConfig && supabase) {
    const { error } = await supabase.from(TABLE_NAME).insert({
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
    });

    if (error) {
      throw error;
    }
  }

  return nextRecords;
}

export async function updateRbMonitoringRecord(record) {
  const existingRecords = readLocalRecords();
  const nextRecords = existingRecords.some((item) => item.id === record.id)
    ? existingRecords.map((item) => (item.id === record.id ? record : item))
    : [record, ...existingRecords];

  writeLocalRecords(nextRecords.slice(0, 100));

  if (hasSupabaseConfig && supabase) {
    const { error } = await supabase.from(TABLE_NAME).upsert({
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
    });

    if (error) {
      throw error;
    }
  }

  return nextRecords.slice(0, 100);
}
