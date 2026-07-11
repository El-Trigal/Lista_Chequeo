import { Fragment, useEffect, useMemo, useState } from "react";
import {
  RecordFilters,
  createEmptyRecordFilters,
  getRecordFilterOptions,
  matchesRecordFilters,
  toggleRecordFilterValue
} from "./RecordFilters";
import { formatNumber } from "./lib/checklistMath";
import {
  downloadRbRootingRecordsExcel,
  getCurrentWeekCode
} from "./lib/excelExport";
import { sanitizeDecimalInput } from "./lib/inputFormat";
import { hasSupabaseConfig } from "./lib/supabase";
import {
  deleteRbRootingRecord,
  loadRbRootingRecords,
  saveRbRootingRecord,
  updateRbRootingRecord
} from "./lib/rbRootingRecords";

const CHECKLIST_VIEW = "checklist";
const RECORDS_VIEW = "records";
const ASSIGNED_TRAYS = 60;
const RENDIMIENTO_SCORE = 10;
const SIMULACROS_SCORE = 20;
const REPORTE_SCORE = 10;
const REQUIREMENTS_TOTAL = SIMULACROS_SCORE + REPORTE_SCORE;
const QUALITY_ITEMS = [
  {
    id: "kit_monitoreo",
    label: "El monitor cumple con el kit de monitoreo",
    criterion:
      "Varas de aluminio, carné con la sintomatología, bolsas, lapicero, libreta, lupa 30x, alcohol, gotero con aceite, cintas, pijama, chaleco, guantes.",
    weight: 15
  },
  {
    id: "unidad_monitorear",
    label: "El monitor cuenta con la unidad a monitorear",
    criterion: "El monitor se ubica en el banco asignado a monitorear.",
    weight: 5
  },
  {
    id: "desglose_labor",
    label: "El monitor cumple con el desglose de la labor",
    criterion: "Si no cumple, describir el paso o punto clave a mejorar.",
    weight: 20
  },
  {
    id: "disposicion_varas",
    label: "Disposición de las varas",
    criterion:
      "Cuando el monitor detiene el monitoreo deja las varas en la línea y al retomar vuelve a revisar.",
    weight: 5
  },
  {
    id: "desinfeccion_varas",
    label: "Desinfecta varas y se asperja con alcohol",
    criterion:
      "Al finalizar el monitoreo de un lado y del banco completo se detiene, desinfecta las varas y se asperja con alcohol en todo su cuerpo.",
    weight: 5
  },
  {
    id: "recoleccion_hallazgo",
    label: "Recolección del hallazgo",
    criterion:
      "El monitor recolecta de manera adecuada el esqueje donde se observa el hallazgo en forma de guante.",
    weight: 10
  },
  {
    id: "reporte_sintomatologia",
    label: "Reporta sintomatología sospechosa",
    criterion:
      "Cuando encuentra sintomatología sospechosa y tiene dudas, reporta a su jefe.",
    weight: 5
  },
  {
    id: "reporte_hallazgo",
    label: "Genera el reporte de un hallazgo según lo establecido",
    criterion: "Banco, variedad, adjunta foto donde se observa la finca de origen.",
    weight: 10
  },
  {
    id: "descansos",
    label: "Cumple con los tiempos establecidos para los descansos",
    criterion:
      "Realiza los descansos únicamente en los tiempos autorizados, evitando permanecer al final del banco o sostener conversaciones excesivas con sus compañeros.",
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

function createInitialForm() {
  return {
    monitorName: "",
    assurerName: "",
    monitoredTrays: "",
    sites: Array.from({ length: 3 }, () => ({
      bank: "",
      disposed: "",
      found: ""
    })),
    reportStatus: null,
    qualityAnswers: createAnswerMap(QUALITY_ITEMS),
    commitments: ""
  };
}

function createExpandedSections(expanded = true) {
  return {
    rendimiento: expanded,
    simulacros: expanded,
    reporte: expanded,
    calidad: expanded
  };
}

function sanitizeMonitoredTraysInput(value) {
  const sanitizedValue = sanitizeDecimalInput(value);

  if (!sanitizedValue) {
    return "";
  }

  const numericValue = Number(sanitizedValue);
  return Number.isFinite(numericValue) && numericValue > ASSIGNED_TRAYS
    ? String(ASSIGNED_TRAYS)
    : sanitizedValue;
}

function calculateRendimientoScore(monitoredTrays) {
  const trays = Math.max(0, Math.min(ASSIGNED_TRAYS, Number(monitoredTrays) || 0));
  return Math.round((trays / ASSIGNED_TRAYS) * RENDIMIENTO_SCORE);
}

function calculateSimulacros(form) {
  const sites = Array.isArray(form.sites) ? form.sites : [];
  const hasExplicitZeroSimulacros = sites.length > 0 && sites.every(
    (site) => String(site.disposed).trim() === "0" && String(site.found).trim() === "0"
  );
  const rawTotalDisposed = sites.reduce((sum, site) => sum + (Number(site.disposed) || 0), 0);
  const rawTotalFound = sites.reduce((sum, site) => sum + (Number(site.found) || 0), 0);
  const totalDisposed = hasExplicitZeroSimulacros ? 0 : rawTotalDisposed;
  const totalFound = hasExplicitZeroSimulacros ? 0 : rawTotalFound;
  const percent = hasExplicitZeroSimulacros ? 100 : totalDisposed > 0 ? (totalFound / totalDisposed) * 100 : 0;
  const score = hasExplicitZeroSimulacros
    ? SIMULACROS_SCORE
    : totalDisposed <= 0
      ? 0
      : percent >= 90
        ? 20
        : percent >= 80
          ? 15
          : 5;

  return {
    score,
    percent,
    totalDisposed,
    totalFound,
    hasExplicitZeroSimulacros
  };
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
    String(form.monitoredTrays).trim()
  );
}

function isSimulacrosComplete(form) {
  return form.sites.every((site) =>
    site.bank.trim() &&
    String(site.disposed).trim() &&
    String(site.found).trim()
  );
}

function calculateRbRootingScore(form) {
  const rendimientoScore = calculateRendimientoScore(form.monitoredTrays);
  const simulacros = calculateSimulacros(form);
  const reportScore = form.reportStatus === "yes" ? REPORTE_SCORE : 0;
  const qualityScore = calculateQualityScore(form.qualityAnswers);
  const totalScore = rendimientoScore + simulacros.score + reportScore + qualityScore;
  const percent = TOTAL_SCORE ? (totalScore / TOTAL_SCORE) * 100 : 0;
  const compliant = [];
  const nonCompliant = [];

  if (String(form.monitoredTrays).trim()) {
    const row = {
      sectionTitle: "Bandejas monitoreadas",
      itemLabel: "Número de bandejas monitoreadas por hora",
      criterion: `${formatNumber(Number(form.monitoredTrays) || 0)} de ${ASSIGNED_TRAYS} bandejas asignadas por hora.`,
      weight: RENDIMIENTO_SCORE
    };
    (rendimientoScore >= RENDIMIENTO_SCORE ? compliant : nonCompliant).push(row);
  }

  if (simulacros.hasExplicitZeroSimulacros || simulacros.totalDisposed > 0) {
    const row = {
      sectionTitle: "Simulacros",
      itemLabel: "Simulacros encontrados",
      criterion: `${formatNumber(simulacros.totalFound)} encontrados de ${formatNumber(simulacros.totalDisposed)} dispuestos.`,
      weight: simulacros.score
    };
    (simulacros.hasExplicitZeroSimulacros || simulacros.percent >= 90 ? compliant : nonCompliant).push(row);
  }

  const reportRow = {
    sectionTitle: "Reporte",
    itemLabel: "Reporte de la bandeja",
    criterion: "Se realiza el reporte de la bandeja.",
    weight: REPORTE_SCORE
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
    simulacrosScore: simulacros.score,
    simulacrosPercent: simulacros.percent,
    totalDisposed: simulacros.totalDisposed,
    totalFound: simulacros.totalFound,
    reportScore,
    qualityScore,
    totalScore,
    percent,
    compliant,
    nonCompliant
  };
}

function normalizeRbRootingRecord(record) {
  const recalculated = calculateRbRootingScore({
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

function RbRootingStartScreen({ saveState, permissions, onCreate }) {
  return (
    <section className="checklist-start">
      <div>
        <p className="eyebrow">Chequeo</p>
        <h2>Aseguramiento de monitoreo RB Bancos de enraizamiento</h2>
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

function RbRootingRecords({ records, recordsSource, isLoading, permissions, onEditRecord }) {
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

    downloadRbRootingRecordsExcel(filteredRecords);
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
            collaboratorLabel="Monitor"
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
          <span>Monitor</span>
          <span>Asegurador</span>
          <span>Fecha</span>
          <span>Semana</span>
          <span>Calificación</span>
          <span>%</span>
          <span>Acción</span>
        </div>
        {isLoading ? (
          <RecordsLoadingState />
        ) : filteredRecords.length ? filteredRecords.map((record) => (
          <Fragment key={record.id}>
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
          </Fragment>
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
        title="Bandejas monitoreadas"
        expanded={expanded}
        onToggle={onToggle}
        rightSlot={<div className="section-score">{formatNumber(score)} / {formatNumber(RENDIMIENTO_SCORE)}</div>}
      />
      {expanded ? (
        <div className="collapsible-content">
          <div className="field-grid rb-monitoring-fields">
            <label className="form-field">
              <span>Monitor</span>
              <input type="text" value={form.monitorName} disabled={readOnly} onChange={(event) => onChange({ monitorName: event.target.value })} />
            </label>
            <label className="form-field">
              <span>Asegurador/a</span>
              <input type="text" value={form.assurerName} disabled={readOnly} onChange={(event) => onChange({ assurerName: event.target.value })} />
            </label>
            <label className="form-field">
              <span>Número de bandejas asignadas/hora</span>
              <input type="text" value={ASSIGNED_TRAYS} disabled readOnly />
            </label>
            <label className="form-field">
              <span>Número de bandejas monitoreadas/hora</span>
              <input
                type="text"
                inputMode="decimal"
                value={form.monitoredTrays}
                disabled={readOnly}
                onChange={(event) => onChange({ monitoredTrays: sanitizeMonitoredTraysInput(event.target.value) })}
              />
            </label>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function SimulacrosSection({ form, expanded, onToggle, onChange, result, readOnly }) {
  const isComplete = isSimulacrosComplete(form);

  function updateSite(index, patch) {
    onChange({
      sites: form.sites.map((site, siteIndex) =>
        siteIndex === index ? { ...site, ...patch } : site
      )
    });
  }

  return (
    <section className={isComplete ? "section-band completed-section" : "section-band"}>
      <SectionHeader
        number="02"
        title="Simulacros"
        expanded={expanded}
        onToggle={onToggle}
        rightSlot={<div className="section-score">{formatNumber(result.simulacrosScore)} / {formatNumber(SIMULACROS_SCORE)}</div>}
      />
      {expanded ? (
        <div className="collapsible-content">
          <div className="simulacros-table">
            <div className="simulacros-head rooting-simulacros-head">
              <span>Sitio</span>
              <span>Banco</span>
              <span># dispuestos</span>
              <span># encontrados</span>
            </div>
            {form.sites.map((site, index) => (
              <div className="simulacros-row rooting-simulacros-row" key={index}>
                <div>Sitio {index + 1}</div>
                <div>
                  <input
                    type="text"
                    value={site.bank}
                    disabled={readOnly}
                    onChange={(event) => updateSite(index, { bank: event.target.value })}
                  />
                </div>
                <div>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={site.disposed}
                    disabled={readOnly}
                    onChange={(event) => updateSite(index, { disposed: sanitizeDecimalInput(event.target.value) })}
                  />
                </div>
                <div>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={site.found}
                    disabled={readOnly}
                    onChange={(event) => updateSite(index, { found: sanitizeDecimalInput(event.target.value) })}
                  />
                </div>
              </div>
            ))}
          </div>
          <div className="matrix-score-note">
            <span>Encontrados: {formatNumber(result.totalFound)} / Dispuestos: {formatNumber(result.totalDisposed)}</span>
            <span>{formatNumber(result.simulacrosPercent)}%</span>
            <strong>Puntaje aplicado: {formatNumber(result.simulacrosScore)} / {formatNumber(SIMULACROS_SCORE)}</strong>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function ReportSection({ form, expanded, onToggle, onChange, readOnly }) {
  const isComplete = Boolean(form.reportStatus);
  const score = form.reportStatus === "yes" ? REPORTE_SCORE : 0;

  return (
    <section className={isComplete ? "section-band completed-section" : "section-band"}>
      <SectionHeader
        number="03"
        title="Reporte"
        expanded={expanded}
        onToggle={onToggle}
        rightSlot={<div className="section-score">{formatNumber(score)} / {formatNumber(REPORTE_SCORE)}</div>}
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
              <div className="item-title">Reporte de la bandeja</div>
              <div className="item-criterion">Se realiza el reporte de la bandeja.</div>
              <div className="item-weight">{formatNumber(REPORTE_SCORE)}</div>
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

export default function RbRootingMonitoringApp({ currentUser, permissions, onHome, onLogout }) {
  const [view, setView] = useState(permissions.canCreateChecklists ? CHECKLIST_VIEW : RECORDS_VIEW);
  const [isChecklistActive, setIsChecklistActive] = useState(false);
  const [form, setForm] = useState(createInitialForm);
  const [expandedSections, setExpandedSections] = useState(() => createExpandedSections(true));
  const [records, setRecords] = useState([]);
  const [recordsSource, setRecordsSource] = useState("Local");
  const [isRecordsLoading, setIsRecordsLoading] = useState(true);
  const [saveState, setSaveState] = useState(null);
  const [editingRecord, setEditingRecord] = useState(null);
  const result = useMemo(() => calculateRbRootingScore(form), [form]);
  const answeredCount =
    (isRendimientoComplete(form) ? 1 : 0) +
    (isSimulacrosComplete(form) ? 1 : 0) +
    (form.reportStatus ? 1 : 0) +
    (areQualityItemsComplete(form.qualityAnswers) ? 1 : 0);

  async function refreshRecords() {
    setIsRecordsLoading(true);
    try {
      const loaded = await loadRbRootingRecords();
      setRecords(loaded.records.map(normalizeRbRootingRecord));
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
      ? await updateRbRootingRecord(record)
      : await saveRbRootingRecord(record);
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
      const nextRecords = await deleteRbRootingRecord(editingRecord.id);
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
          <h1>Aseguramiento de monitoreo RB Bancos de enraizamiento</h1>
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
            <SimulacrosSection form={form} expanded={expandedSections.simulacros} onToggle={() => toggleSection("simulacros")} onChange={updateForm} result={result} readOnly={!permissions.canEditRecords} />
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
          <RbRootingStartScreen saveState={saveState} permissions={permissions} onCreate={startChecklist} />
        )
      ) : (
        <RbRootingRecords
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
