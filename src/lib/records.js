import { hasSupabaseConfig, supabase } from "./supabase";

const LOCAL_STORAGE_KEY = "spray-checklist-records";
const TABLE_NAME = "spray_checklist_records";

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
    metadata: row.metadata ?? {},
    products: row.products ?? [],
    answers: row.answers ?? {},
    observations: row.observations ?? "",
    score: Number(row.score ?? 0),
    maxScore: Number(row.max_score ?? 0),
    nonCompliantScore: row.non_compliant_score == null ? null : Number(row.non_compliant_score),
    calificationBaseScore: row.calification_base_score == null ? 212 : Number(row.calification_base_score),
    calificationPercent: row.calification_percent == null ? null : Number(row.calification_percent),
    compliancePercent: Number(row.compliance_percent ?? 0),
    summary: row.summary ?? { compliant: [], nonCompliant: [] }
  };
}

export async function loadRecords() {
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

export async function saveRecord(record) {
  const localRecords = [record, ...readLocalRecords()].slice(0, 100);
  writeLocalRecords(localRecords);

  if (hasSupabaseConfig && supabase) {
    const { error } = await supabase.from(TABLE_NAME).insert({
      id: record.id,
      created_at: record.createdAt,
      finished_at: record.finishedAt,
      metadata: record.metadata,
      products: record.products,
      answers: record.answers,
      observations: record.observations,
      score: record.score,
      max_score: record.maxScore,
      non_compliant_score: record.nonCompliantScore,
      calification_base_score: record.calificationBaseScore,
      calification_percent: record.calificationPercent,
      compliance_percent: record.compliancePercent,
      summary: record.summary
    });

    if (error) {
      throw error;
    }
  }

  return localRecords;
}

export async function updateRecord(record) {
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
      metadata: record.metadata,
      products: record.products,
      answers: record.answers,
      observations: record.observations,
      score: record.score,
      max_score: record.maxScore,
      non_compliant_score: record.nonCompliantScore,
      calification_base_score: record.calificationBaseScore,
      calification_percent: record.calificationPercent,
      compliance_percent: record.compliancePercent,
      summary: record.summary
    });

    if (error) {
      throw error;
    }
  }

  return nextRecords.slice(0, 100);
}

export function clearLocalRecords() {
  writeLocalRecords([]);
}
