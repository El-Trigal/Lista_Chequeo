import { useEffect, useMemo, useState } from "react";
import {
  RecordFilters,
  createEmptyRecordFilters,
  getRecordFilterOptions,
  matchesRecordFilters,
  toggleRecordFilterValue
} from "./RecordFilters";
import { formatNumber } from "./lib/checklistMath";
import { downloadColdRoomRecordsExcel, getCurrentWeekCode } from "./lib/excelExport";
import { sanitizeDecimalInput } from "./lib/inputFormat";
import { hasSupabaseConfig } from "./lib/supabase";
import {
  deleteColdRoomRecord,
  loadColdRoomRecords,
  saveColdRoomRecord,
  updateColdRoomRecord
} from "./lib/coldRoomRecords";

const CHECKLIST_VIEW = "checklist";
const RECORDS_VIEW = "records";
const ASSIGNED_BAGS = 120;
const RENDIMIENTO_SCORE = 10;
const BASKET_COUNT = 5;
const BAGS_PER_BASKET = 3;
const CONFORMANCE_SCORE = BASKET_COUNT * BAGS_PER_BASKET;
const REPORT_SCORE = 10;
const REQUIREMENTS_TOTAL = CONFORMANCE_SCORE + REPORT_SCORE;
const QUALITY_ITEMS = [
  {
    id: "epp",
    label: "El monitor cumple con los EPP",
    criterion: "Chaqueta, pantalón, medias, guantes, alcohol, botas.",
    weight: 15
  },
  {
    id: "unidad_monitorear",
    label: "El monitor cuenta con la unidad a monitorear",
    criterion: "El monitor se ubica en la fila asignada a monitorear y diferencia entre variedades.",
    weight: 5
  },
  {
    id: "desglose_labor",
    label: "El monitor cumple con el desglose de la labor",
    criterion: "Si no cumple, describir el paso o punto clave a mejorar.",
    weight: 20
  },
  {
    id: "marcacion_canastilla",
    label: "Marcación de canastilla",
    criterion: "Cuando el monitor se detiene o finaliza la fila marca la canastilla.",
    weight: 5
  },
  {
    id: "recoleccion_hallazgo",
    label: "Recolección del hallazgo",
    criterion: "El monitor recolecta de manera adecuada el esqueje donde se observa RB en forma de guante.",
    weight: 10
  },
  {
    id: "reporte_sintomatologia",
    label: "Reporta sintomatología sospechosa",
    criterion: "Cuando encuentra sintomatología sospechosa y tiene dudas, reporta a su jefe.",
    weight: 5
  },
  {
    id: "reporte_hallazgo",
    label: "Genera el reporte de un hallazgo según lo establecido",
    criterion: "Variedad y adjunta foto donde se observa la finca de origen.",
    weight: 10
  },
  {
    id: "descansos",
    label: "Cumple con los tiempos establecidos para los descansos",
    criterion:
      "Realiza los descansos únicamente en los tiempos autorizados, evita sostener conversaciones excesivas con sus compañeros.",
    weight: 10
  },
  {
    id: "dispositivos",
    label: "Usa adecuadamente los dispositivos electrónicos",
    criterion: "Uso adecuado de dispositivos electrónicos.",
    weight: 15
  }
];
const QUALITY_TOTAL = QUALITY_ITEMS.reduce((total, item) => total + item.weight, 0);
const TOTAL_SCORE = RENDIMIENTO_SCORE + REQUIREMENTS_TOTAL + QUALITY_TOTAL;

function formatSavedDate(date) {
  return date.toLocaleDateString("es-CO", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
}

function formatSavedTime(date) {
  return date.toLocaleTimeString("es-CO", {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function createAnswerMap(items) {
  return items.reduce((answers, item) => ({ ...answers, [item.id]: null }), {});
}

function createBaskets() {
  return Array.from({ length: BASKET_COUNT }, () => ({
    bags: Array.from({ length: BAGS_PER_BASKET }, () => null)
  }));
}

function createInitialForm() {
  return {
    monitorName: "",
    assurerName: "",
    monitoredBags: "",
    baskets: createBaskets(),
    reportStatus: null,
    qualityAnswers: createAnswerMap(QUALITY_ITEMS),
    commitments: ""
  };
}

function createExpandedSections(expanded = true) {
  return {
    rendimiento: expanded,
    conformidad: expanded,
    reporte: expanded,
    calidad: expanded
  };
}

function getBaskets(form) {
  const currentBaskets = Array.isArray(form.baskets) ? form.baskets : [];
  return Array.from({ length: BASKET_COUNT }, (_, basketIndex) => {
    const basket = currentBaskets[basketIndex] ?? {};
    const bags = Array.isArray(basket.bags) ? basket.bags : [];
    return {
      bags: Array.from({ length: BAGS_PER_BASKET }, (_, bagIndex) => bags[bagIndex] ?? null)
    };
  });
}

function sanitizeMonitoredBagsInput(value) {
  const sanitizedValue = sanitizeDecimalInput(value);
  if (!sanitizedValue) return "";
  const numericValue = Number(sanitizedValue);
  return Number.isFinite(numericValue) && numericValue > ASSIGNED_BAGS
    ? String(ASSIGNED_BAGS)
    : sanitizedValue;
}

function calculateRendimientoScore(monitoredBags) {
  const bags = Math.max(0, Math.min(ASSIGNED_BAGS, Number(monitoredBags) || 0));
  return Math.round((bags / ASSIGNED_BAGS) * RENDIMIENTO_SCORE);
}

function calculateConformanceScore(form) {
  return getBaskets(form).reduce((score, basket) =>
    score + basket.bags.filter((status) => status === "yes").length,
  0);
}

function isConformanceComplete(form) {
  return getBaskets(form).every((basket) => basket.bags.every(Boolean));
}

function calculateQualityScore(answers) {
  return QUALITY_ITEMS.reduce((score, item) =>
    score + (answers[item.id] === "yes" ? item.weight : 0),
  0);
}

function areQualityItemsComplete(answers) {
  return QUALITY_ITEMS.every((item) => Boolean(answers[item.id]));
}

function isRendimientoComplete(form) {
  return Boolean(
    form.monitorName.trim() &&
    form.assurerName.trim() &&
    String(form.monitoredBags).trim()
  );
}

function calculateColdRoomScore(form) {
  const rendimientoScore = calculateRendimientoScore(form.monitoredBags);
  const conformanceScore = calculateConformanceScore(form);
  const reportScore = form.reportStatus === "yes" ? REPORT_SCORE : 0;
  const qualityScore = calculateQualityScore(form.qualityAnswers);
  const totalScore = rendimientoScore + conformanceScore + reportScore + qualityScore;
  const percent = TOTAL_SCORE ? (totalScore / TOTAL_SCORE) * 100 : 0;
  const compliant = [];
  const nonCompliant = [];

  if (String(form.monitoredBags).trim()) {
    const row = {
      sectionTitle: "Bolsas monitoreadas",
      itemLabel: "Número de bolsas monitoreadas por hora",
      criterion: `${formatNumber(Number(form.monitoredBags) || 0)} de ${ASSIGNED_BAGS} bolsas asignadas por hora.`,
      weight: RENDIMIENTO_SCORE
    };
    (rendimientoScore >= RENDIMIENTO_SCORE ? compliant : nonCompliant).push(row);
  }

  getBaskets(form).forEach((basket, index) => {
    if (!basket.bags.some(Boolean)) return;
    const basketScore = basket.bags.filter((status) => status === "yes").length;
    const row = {
      sectionTitle: "Conformidad de la labor",
      itemLabel: `Canastilla ${index + 1}`,
      criterion: `${formatNumber(basketScore)} de ${BAGS_PER_BASKET} bolsas cumplen.`,
      weight: basketScore
    };
    (basketScore === BAGS_PER_BASKET ? compliant : nonCompliant).push(row);
  });

  const reportRow = {
    sectionTitle: "Reporte",
    itemLabel: "Reporte de la canastilla",
    criterion: "Se realiza el reporte de la canastilla.",
    weight: REPORT_SCORE
  };
  if (form.reportStatus === "yes") {
    compliant.push(reportRow);
  } else if (form.reportStatus === "no") {
    nonCompliant.push(reportRow);
  }

  for (const item of QUALITY_ITEMS) {
    const row = {
      sectionTitle: "Calidad",
      itemLabel: item.label,
      criterion: item.criterion,
      weight: item.weight
    };
    if (form.qualityAnswers[item.id] === "yes") {
      compliant.push(row);
    } else if (form.qualityAnswers[item.id] === "no") {
      nonCompliant.push(row);
    }
  }

  return {
    rendimientoScore,
    conformanceScore,
    reportScore,
    qualityScore,
    totalScore,
    percent,
    compliant,
    nonCompliant
  };
}

function normalizeColdRoomRecord(record) {
  const recalculated = calculateColdRoomScore({
    ...createInitialForm(),
    ...(record.form ?? {})
  });
  return {
    ...record,
    score: recalculated.totalScore,
    percent: recalculated.percent,
    summary: {
      compliant: recalculated.compliant,
      nonCompliant: recalculated.nonCompliant
    }
  };
}

function StatusToggle({ value, onChange, disabled = false }) {
  return (
    <div className="status-toggle" role="group" aria-label="Cumplimiento">
      <button type="button" className={value === "yes" ? "selected yes" : ""} disabled={disabled} onClick={() => onChange("yes")}>Sí</button>
      <button type="button" className={value === "no" ? "selected no" : ""} disabled={disabled} onClick={() => onChange("no")}>No</button>
    </div>
  );
}

function BagComplianceToggle({ value, onChange, disabled = false }) {
  return (
    <div className="direct-site-toggle" role="group" aria-label="Cumplimiento de la bolsa">
      <button
        type="button"
        className={value === "yes" ? "selected yes" : ""}
        disabled={disabled}
        aria-label="Cumple"
        title="Cumple"
        onClick={() => onChange("yes")}
      >
        ✓
      </button>
      <button
        type="button"
        className={value === "no" ? "selected no" : ""}
        disabled={disabled}
        aria-label="No cumple"
        title="No cumple"
        onClick={() => onChange("no")}
      >
        X
      </button>
    </div>
  );
}

function SectionHeader({ number, title, expanded, onToggle, rightSlot }) {
  return (
    <div className="section-heading">
      <div>
        <span className="section-index">{number}</span>
        <h2>{title}</h2>
      </div>
      <div className="section-heading-actions">
        {rightSlot}
        <button
          type="button"
          className={expanded ? "collapse-button expanded" : "collapse-button collapsed"}
          aria-expanded={expanded}
          aria-label={expanded ? "Plegar apartado" : "Desplegar apartado"}
          title={expanded ? "Plegar apartado" : "Desplegar apartado"}
          onClick={onToggle}
        >
          <span className="collapse-icon" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

function RecordsLoadingState() {
  return (
    <div className="records-loading" role="status" aria-live="polite">
      <span className="loading-spinner" aria-hidden="true" />
      <span>Cargando registros...</span>
    </div>
  );
}

function SummaryColumns({ compliant, nonCompliant, commitments }) {
  return (
    <div className="summary-grid">
      <div className="summary-column good">
        <h3>Cumple</h3>
        {compliant.length ? compliant.map((row) => (
          <p key={`${row.sectionTitle}-${row.itemLabel}`}>
            <strong>{row.itemLabel}</strong>
            <span>{row.sectionTitle}</span>
          </p>
        )) : <p className="empty-state">Sin ítems marcados.</p>}
      </div>
      <div className="summary-column bad">
        <h3>No cumple</h3>
        {nonCompliant.length ? nonCompliant.map((row) => (
          <p key={`${row.sectionTitle}-${row.itemLabel}`}>
            <strong>{row.itemLabel}</strong>
            <span>{row.criterion}</span>
          </p>
        )) : <p className="empty-state">Sin novedades.</p>}
      </div>
      <div className="summary-column notes">
        <h3>Compromisos</h3>
        {commitments?.trim() ? <p>{commitments}</p> : <p className="empty-state">Sin compromisos.</p>}
      </div>
    </div>
  );
}

function ColdRoomStartScreen({ saveState, permissions, onCreate }) {
  return (
    <section className="checklist-start">
      <div>
        <p className="eyebrow">Chequeo</p>
        <h2>Aseguramiento de monitoreo en Cuarto frío</h2>
        <p>Inicia un nuevo registro para desplegar las secciones del chequeo.</p>
      </div>
      {permissions.canCreateChecklists ? (
        <button type="button" className="primary-action create-checklist-button" onClick={onCreate}>
          Crear Chequeo
        </button>
      ) : (
        <p className="permission-note">Tu usuario puede ver registros, pero no crear chequeos.</p>
      )}
      {saveState ? <span className={saveState.type}>{saveState.message}</span> : null}
    </section>
  );
}

function ColdRoomRecords({ records, recordsSource, isLoading, permissions, onEditRecord }) {
  const [expandedRecordId, setExpandedRecordId] = useState(null);
  const [draftFilters, setDraftFilters] = useState(createEmptyRecordFilters);
  const [appliedFilters, setAppliedFilters] = useState(createEmptyRecordFilters);

  function getFilterValues(record) {
    return {
      week: record.weekCode,
      date: record.savedDate,
      collaborator: record.form?.monitorName,
      assurer: record.form?.assurerName
    };
  }

  const filterOptions = useMemo(() => getRecordFilterOptions(records, getFilterValues), [records]);
  const filteredRecords = useMemo(() => records.filter((record) =>
    matchesRecordFilters(getFilterValues(record), appliedFilters)
  ), [records, appliedFilters]);

  function toggleFilter(field, value) {
    setDraftFilters((current) => toggleRecordFilterValue(current, field, value));
  }

  function applyFilters() {
    setAppliedFilters(draftFilters);
  }

  function clearFilters() {
    const emptyFilters = createEmptyRecordFilters();
    setDraftFilters(emptyFilters);
    setAppliedFilters(emptyFilters);
  }

  function handleDownloadExcel() {
    if (!filteredRecords.length) {
      window.alert("No hay registros para descargar con los filtros actuales.");
      return;
    }
    downloadColdRoomRecordsExcel(filteredRecords);
  }

  return (
    <section className="records-section">
      <div className="records-heading">
        <div>
          <span className="section-index">Registros</span>
          <h2>Chequeos guardados</h2>
        </div>
        <div className="records-actions">
          <RecordFilters
            options={filterOptions}
            draftFilters={draftFilters}
            appliedFilters={appliedFilters}
            onToggle={toggleFilter}
            onApply={applyFilters}
            onClear={clearFilters}
            collaboratorLabel="Monitor/a"
          />
          {permissions.canDownloadExcel ? (
            <button type="button" className="secondary-action" onClick={handleDownloadExcel}>
              Descargar Excel
            </button>
          ) : null}
          <span className="source-pill">{recordsSource}</span>
        </div>
      </div>

      <div className="rb-records-table">
        <div className="rb-records-head">
          <span>Monitor/a</span>
          <span>Asegurador/a</span>
          <span>Fecha</span>
          <span>Semana</span>
          <span>Calificación</span>
          <span>%</span>
          <span>Acción</span>
        </div>
        {isLoading ? (
          <RecordsLoadingState />
        ) : filteredRecords.length ? filteredRecords.map((record) => (
          <div className="rb-record-wrapper" key={record.id}>
            <div
              role="button"
              tabIndex={0}
              className={expandedRecordId === record.id ? "rb-records-row expanded" : "rb-records-row"}
              onClick={() => setExpandedRecordId((current) => (current === record.id ? null : record.id))}
            >
              <span>{record.form?.monitorName || "-"}</span>
              <span>{record.form?.assurerName || "-"}</span>
              <span>{record.savedDate || "-"}</span>
              <span>{record.weekCode || "-"}</span>
              <span>{formatNumber(record.score)} / {formatNumber(TOTAL_SCORE)}</span>
              <span>{formatNumber(record.percent)}%</span>
              <span>
                {record.syncStatus === "pending" ? <em className="sync-status-pill">Pendiente</em> : null}
                <button
                  type="button"
                  className="edit-record-button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onEditRecord(record);
                  }}
                >
                  {permissions.canEditRecords ? "Editar" : "Ver"}
                </button>
              </span>
            </div>
            {expandedRecordId === record.id ? (
              <div className="record-summary">
                <div className="record-summary-title">
                  <strong>Resumen del registro</strong>
                  <span>{formatNumber(record.score)} / {formatNumber(TOTAL_SCORE)} - {formatNumber(record.percent)}%</span>
                </div>
                <SummaryColumns
                  compliant={record.summary?.compliant ?? []}
                  nonCompliant={record.summary?.nonCompliant ?? []}
                  commitments={record.form?.commitments}
                />
              </div>
            ) : null}
          </div>
        )) : <div className="records-empty">No hay registros guardados.</div>}
      </div>
    </section>
  );
}

function RendimientoSection({ form, expanded, onToggle, onChange, score, readOnly }) {
  const isComplete = isRendimientoComplete(form);
  return (
    <section className={isComplete ? "section-band completed-section" : "section-band"}>
      <SectionHeader
        number="01"
        title="Bolsas monitoreadas"
        expanded={expanded}
        onToggle={onToggle}
        rightSlot={<div className="section-score">{formatNumber(score)} / {formatNumber(RENDIMIENTO_SCORE)}</div>}
      />
      {expanded ? (
        <div className="collapsible-content">
          <div className="field-grid rb-monitoring-fields">
            <label className="form-field">
              <span>Monitor/a</span>
              <input type="text" value={form.monitorName} disabled={readOnly} onChange={(event) => onChange({ monitorName: event.target.value })} />
            </label>
            <label className="form-field">
              <span>Asegurador/a</span>
              <input type="text" value={form.assurerName} disabled={readOnly} onChange={(event) => onChange({ assurerName: event.target.value })} />
            </label>
            <label className="form-field">
              <span>Número de bolsas asignadas/hora</span>
              <input type="text" value={ASSIGNED_BAGS} disabled readOnly />
            </label>
            <label className="form-field">
              <span>Número de bolsas monitoreadas/hora</span>
              <input
                type="text"
                inputMode="decimal"
                value={form.monitoredBags}
                disabled={readOnly}
                onChange={(event) => onChange({ monitoredBags: sanitizeMonitoredBagsInput(event.target.value) })}
              />
            </label>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function ConformanceSection({ form, expanded, onToggle, onChange, score, readOnly }) {
  const baskets = getBaskets(form);
  const isComplete = isConformanceComplete(form);

  function updateBag(basketIndex, bagIndex, status) {
    onChange({
      baskets: baskets.map((basket, currentBasketIndex) => {
        if (currentBasketIndex !== basketIndex) return basket;
        return {
          ...basket,
          bags: basket.bags.map((bagStatus, currentBagIndex) =>
            currentBagIndex === bagIndex ? status : bagStatus
          )
        };
      })
    });
  }

  return (
    <section className={isComplete ? "section-band completed-section" : "section-band"}>
      <SectionHeader
        number="02"
        title="Conformidad de la labor"
        expanded={expanded}
        onToggle={onToggle}
        rightSlot={<div className="section-score">{formatNumber(score)} / {formatNumber(CONFORMANCE_SCORE)}</div>}
      />
      {expanded ? (
        <div className="collapsible-content">
          <div className="direct-monitoring-table cold-room-baskets-grid">
            {baskets.map((basket, basketIndex) => {
              const basketScore = basket.bags.filter((status) => status === "yes").length;
              const basketComplete = basket.bags.every(Boolean);
              return (
                <div className={basketComplete ? "direct-bed-card completed-direct-bed" : "direct-bed-card"} key={basketIndex}>
                  <div className="direct-bed-header">
                    <strong>Peso 3 puntos por canastilla</strong>
                    <span>Canastilla {basketIndex + 1}</span>
                  </div>
                  <div className="direct-sites-grid cold-room-bags-grid">
                    {basket.bags.map((status, bagIndex) => (
                      <div className="direct-site-cell" key={bagIndex}>
                        <span>Bolsa {bagIndex + 1}</span>
                        <BagComplianceToggle
                          value={status}
                          disabled={readOnly}
                          onChange={(value) => updateBag(basketIndex, bagIndex, value)}
                        />
                      </div>
                    ))}
                  </div>
                  <div className="direct-bed-marking">
                    <span>Puntaje canastilla</span>
                    <strong>{formatNumber(basketScore)} / {formatNumber(BAGS_PER_BASKET)}</strong>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function ReportSection({ form, expanded, onToggle, onChange, readOnly }) {
  const isComplete = Boolean(form.reportStatus);
  const score = form.reportStatus === "yes" ? REPORT_SCORE : 0;
  return (
    <section className={isComplete ? "section-band completed-section" : "section-band"}>
      <SectionHeader
        number="03"
        title="Reporte"
        expanded={expanded}
        onToggle={onToggle}
        rightSlot={<div className="section-score">{formatNumber(score)} / {formatNumber(REPORT_SCORE)}</div>}
      />
      {expanded ? (
        <div className="collapsible-content">
          <div className="item-table without-value monitoring-control-table">
            <div className="item-table-head">
              <span>Item</span>
              <span>Criterio</span>
              <span>Peso</span>
              <span>Cumple</span>
            </div>
            <div className="item-row">
              <div className="item-title">Reporte de la canastilla</div>
              <div className="item-criterion">Se realiza el reporte de la canastilla.</div>
              <div className="item-weight">{formatNumber(REPORT_SCORE)}</div>
              <StatusToggle
                value={form.reportStatus}
                disabled={readOnly}
                onChange={(status) => onChange({ reportStatus: status })}
              />
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function QualitySection({ form, expanded, onToggle, onChange, score, readOnly }) {
  const isComplete = areQualityItemsComplete(form.qualityAnswers);
  return (
    <section className={isComplete ? "section-band completed-section" : "section-band"}>
      <SectionHeader
        number="04"
        title="Calidad"
        expanded={expanded}
        onToggle={onToggle}
        rightSlot={<div className="section-score">{formatNumber(score)} / {formatNumber(QUALITY_TOTAL)}</div>}
      />
      {expanded ? (
        <div className="collapsible-content">
          <div className="item-table without-value monitoring-control-table">
            <div className="item-table-head">
              <span>Item</span>
              <span>Criterio</span>
              <span>Peso</span>
              <span>Cumple</span>
            </div>
            {QUALITY_ITEMS.map((item) => (
              <div className="item-row" key={item.id}>
                <div className="item-title">{item.label}</div>
                <div className="item-criterion">{item.criterion}</div>
                <div className="item-weight">{formatNumber(item.weight)}</div>
                <StatusToggle
                  value={form.qualityAnswers[item.id]}
                  disabled={readOnly}
                  onChange={(status) =>
                    onChange({
                      qualityAnswers: {
                        ...form.qualityAnswers,
                        [item.id]: status
                      }
                    })
                  }
                />
              </div>
            ))}
          </div>
          <div className="field-grid rb-monitoring-fields commitments-grid">
            <label className="form-field commitments-field">
              <span>Compromisos</span>
              <textarea
                rows="4"
                value={form.commitments}
                readOnly={readOnly}
                onChange={(event) => onChange({ commitments: event.target.value })}
              />
            </label>
          </div>
        </div>
      ) : null}
    </section>
  );
}

export default function ColdRoomMonitoringApp({ currentUser, permissions, onHome, onLogout }) {
  const [view, setView] = useState(permissions.canCreateChecklists ? CHECKLIST_VIEW : RECORDS_VIEW);
  const [isChecklistActive, setIsChecklistActive] = useState(false);
  const [form, setForm] = useState(createInitialForm);
  const [expandedSections, setExpandedSections] = useState(() => createExpandedSections(true));
  const [records, setRecords] = useState([]);
  const [recordsSource, setRecordsSource] = useState("Local");
  const [isRecordsLoading, setIsRecordsLoading] = useState(true);
  const [saveState, setSaveState] = useState(null);
  const [editingRecord, setEditingRecord] = useState(null);
  const result = useMemo(() => calculateColdRoomScore(form), [form]);
  const answeredCount =
    (isRendimientoComplete(form) ? 1 : 0) +
    (isConformanceComplete(form) ? 1 : 0) +
    (form.reportStatus ? 1 : 0) +
    (areQualityItemsComplete(form.qualityAnswers) ? 1 : 0);

  async function refreshRecords() {
    setIsRecordsLoading(true);
    try {
      const loaded = await loadColdRoomRecords();
      setRecords(loaded.records.map(normalizeColdRoomRecord));
      setRecordsSource(loaded.sourceLabel);
    } finally {
      setIsRecordsLoading(false);
    }
  }

  useEffect(() => {
    refreshRecords();
    function handleConnectivityChange() { refreshRecords(); }
    function handleVisibilityChange() { if (document.visibilityState === "visible") refreshRecords(); }
    window.addEventListener("online", handleConnectivityChange);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("online", handleConnectivityChange);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  useEffect(() => {
    if (view === RECORDS_VIEW) {
      refreshRecords();
      const intervalId = window.setInterval(refreshRecords, 15000);
      return () => window.clearInterval(intervalId);
    }
    return undefined;
  }, [view]);

  function updateForm(patch) {
    setForm((current) => ({ ...current, ...patch }));
  }

  function toggleSection(sectionId) {
    setExpandedSections((current) => ({ ...current, [sectionId]: !current[sectionId] }));
  }

  function clearChecklistData(clearSaveState = true) {
    setForm(createInitialForm());
    setExpandedSections(createExpandedSections(true));
    setEditingRecord(null);
    if (clearSaveState) setSaveState(null);
  }

  function startChecklist() {
    clearChecklistData();
    setIsChecklistActive(true);
    setView(CHECKLIST_VIEW);
  }

  function editRecord(record) {
    setForm({ ...createInitialForm(), ...(record.form ?? {}) });
    setEditingRecord(record);
    setSaveState(null);
    setExpandedSections(createExpandedSections(true));
    setIsChecklistActive(true);
    setView(CHECKLIST_VIEW);
  }

  function cancelEditRecord() {
    if (!permissions.canEditRecords) {
      clearChecklistData();
      setIsChecklistActive(false);
      setView(RECORDS_VIEW);
      return;
    }
    const shouldLeave = window.confirm("¿Seguro que quieres dejar de editar este chequeo? No se guardará ningún cambio que hayas hecho.");
    if (!shouldLeave) return;
    clearChecklistData();
    setIsChecklistActive(false);
    setView(CHECKLIST_VIEW);
  }

  function returnHome() {
    if (isChecklistActive && editingRecord && permissions.canEditRecords) {
      const shouldLeave = window.confirm("¿Seguro que quieres dejar de editar este chequeo? No se guardará ningún cambio que hayas hecho.");
      if (!shouldLeave) return;
    } else if (isChecklistActive) {
      const shouldLeave = window.confirm("¿Seguro que quieres salir sin terminar el chequeo?");
      if (!shouldLeave) return;
    }
    clearChecklistData();
    setIsChecklistActive(false);
    setView(CHECKLIST_VIEW);
    onHome();
  }

  function getLocalSourceLabel(nextRecords) {
    const pendingCount = nextRecords.filter((record) => record.syncStatus === "pending").length;
    if (!pendingCount) return hasSupabaseConfig ? "Supabase" : "Local";
    return `Supabase (${pendingCount} pendiente${pendingCount === 1 ? "" : "s"})`;
  }

  async function handleSaveRecord() {
    if (!permissions.canEditRecords) return;
    const savedAt = new Date();
    const record = {
      id: editingRecord?.id ?? crypto.randomUUID(),
      createdAt: editingRecord?.createdAt ?? savedAt.toISOString(),
      finishedAt: editingRecord?.finishedAt ?? savedAt.toISOString(),
      savedDate: editingRecord?.savedDate ?? formatSavedDate(savedAt),
      savedTime: editingRecord?.savedTime ?? formatSavedTime(savedAt),
      weekCode: editingRecord?.weekCode ?? getCurrentWeekCode(),
      form,
      score: result.totalScore,
      percent: result.percent,
      summary: {
        compliant: result.compliant,
        nonCompliant: result.nonCompliant
      }
    };
    const nextRecords = editingRecord
      ? await updateColdRoomRecord(record)
      : await saveColdRoomRecord(record);
    const isPending = nextRecords.some((item) => item.id === record.id && item.syncStatus === "pending");
    setRecords(nextRecords);
    setRecordsSource(getLocalSourceLabel(nextRecords));
    setSaveState({
      type: "success-message",
      message: isPending
        ? "Registro guardado local. Se sincronizará con Supabase cuando haya conexión."
        : editingRecord ? "Registro actualizado y sincronizado." : "Registro guardado y sincronizado."
    });
    clearChecklistData(false);
    setIsChecklistActive(false);
    setView(CHECKLIST_VIEW);
  }

  async function handleDeleteRecord() {
    if (!editingRecord || !permissions.canDeleteRecords) return;
    const shouldDelete = window.confirm("¿Seguro que quieres eliminar este registro? Esta acción no se puede deshacer.");
    if (!shouldDelete) return;
    try {
      const nextRecords = await deleteColdRoomRecord(editingRecord.id);
      setRecords(nextRecords);
      setRecordsSource(getLocalSourceLabel(nextRecords));
      setSaveState({ type: "success-message", message: "Registro eliminado." });
      clearChecklistData(false);
      setIsChecklistActive(false);
      setView(RECORDS_VIEW);
    } catch {
      window.alert("No se pudo eliminar el registro. Revisa la conexión o los permisos en Supabase.");
    }
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">Flores El Trigal</p>
          <h1>Aseguramiento de monitoreo en Cuarto frío</h1>
        </div>
        <div className="header-actions">
          <span className="source-pill">{hasSupabaseConfig ? "Supabase activo" : "MVP local"}</span>
          <span className="source-pill">{currentUser.label}</span>
          <button type="button" className="ghost-action" onClick={onLogout}>Cerrar sesión</button>
          <button type="button" className="ghost-action" onClick={returnHome}>Inicio</button>
          <button type="button" className={view === CHECKLIST_VIEW ? "tab-button active" : "tab-button"} onClick={() => setView(CHECKLIST_VIEW)}>Chequeo</button>
          <button type="button" className={view === RECORDS_VIEW ? "tab-button active" : "tab-button"} onClick={() => setView(RECORDS_VIEW)}>Registros</button>
        </div>
      </header>

      {view === CHECKLIST_VIEW ? (
        isChecklistActive ? (
          <>
            <section className="progress-strip">
              <div><span>Secciones completas</span><strong>{answeredCount} / 4</strong></div>
              <div><span>Calificación</span><strong>{formatNumber(result.totalScore)} / {formatNumber(TOTAL_SCORE)}</strong></div>
              <div><span>% Calificación</span><strong>{formatNumber(result.percent)}%</strong></div>
              {editingRecord ? (
                <div className="edit-mode-panel">
                  <div><span>Modo</span><strong>{permissions.canEditRecords ? "Edición" : "Visualización"}</strong></div>
                  {permissions.canDeleteRecords ? <button type="button" className="danger-action" onClick={handleDeleteRecord}>Eliminar registro</button> : null}
                  <button type="button" className="danger-action" onClick={cancelEditRecord}>Salir</button>
                </div>
              ) : null}
            </section>
            <RendimientoSection form={form} expanded={expandedSections.rendimiento} onToggle={() => toggleSection("rendimiento")} onChange={updateForm} score={result.rendimientoScore} readOnly={!permissions.canEditRecords} />
            <ConformanceSection form={form} expanded={expandedSections.conformidad} onToggle={() => toggleSection("conformidad")} onChange={updateForm} score={result.conformanceScore} readOnly={!permissions.canEditRecords} />
            <ReportSection form={form} expanded={expandedSections.reporte} onToggle={() => toggleSection("reporte")} onChange={updateForm} readOnly={!permissions.canEditRecords} />
            <QualitySection form={form} expanded={expandedSections.calidad} onToggle={() => toggleSection("calidad")} onChange={updateForm} score={result.qualityScore} readOnly={!permissions.canEditRecords} />
            <section className="summary-panel">
              <div className="summary-top">
                <div><span className="section-index">Resumen</span><h2>Resultado del chequeo</h2></div>
                <div className="score-card">
                  <span>Calificación</span>
                  <strong>{formatNumber(result.totalScore)} / {formatNumber(TOTAL_SCORE)}</strong>
                  <em>{formatNumber(result.percent)}%</em>
                </div>
              </div>
              <SummaryColumns compliant={result.compliant} nonCompliant={result.nonCompliant} commitments={form.commitments} />
              <div className="summary-actions">
                {permissions.canEditRecords ? <button type="button" className="primary-action" onClick={handleSaveRecord}>Guardar registro</button> : null}
              </div>
            </section>
          </>
        ) : (
          <ColdRoomStartScreen saveState={saveState} permissions={permissions} onCreate={startChecklist} />
        )
      ) : (
        <ColdRoomRecords
          records={records}
          recordsSource={recordsSource}
          isLoading={isRecordsLoading}
          permissions={permissions}
          onEditRecord={editRecord}
        />
      )}
    </main>
  );
}
