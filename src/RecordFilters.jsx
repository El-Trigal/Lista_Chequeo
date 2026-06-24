const FILTER_FIELDS = [
  { id: "week", label: "Semana", emptyText: "Sin semanas" },
  { id: "date", label: "Fecha", emptyText: "Sin fechas" },
  { id: "collaborator", label: "Colaborador", emptyText: "Sin colaboradores" },
  { id: "assurer", label: "Asegurador", emptyText: "Sin aseguradores" }
];

function normalizeFilterValue(value) {
  return String(value ?? "").trim();
}

function normalizeComparisonValue(value) {
  return normalizeFilterValue(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function getDateSortValue(value) {
  const match = normalizeFilterValue(value).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);

  if (!match) {
    return null;
  }

  const [, day, month, year] = match;
  return new Date(Number(year), Number(month) - 1, Number(day)).getTime();
}

function sortFilterOptions(fieldId, left, right) {
  if (fieldId === "date") {
    const leftDate = getDateSortValue(left.value);
    const rightDate = getDateSortValue(right.value);

    if (leftDate !== null && rightDate !== null && leftDate !== rightDate) {
      return rightDate - leftDate;
    }
  }

  if (fieldId === "week") {
    return String(right.value).localeCompare(String(left.value), "es", { numeric: true });
  }

  return String(left.value).localeCompare(String(right.value), "es", { sensitivity: "base" });
}

export function createEmptyRecordFilters() {
  return FILTER_FIELDS.reduce((filters, field) => {
    filters[field.id] = [];
    return filters;
  }, {});
}

export function getRecordFilterOptions(records, getValues) {
  const optionMaps = FILTER_FIELDS.reduce((maps, field) => {
    maps[field.id] = new Map();
    return maps;
  }, {});

  records.forEach((record) => {
    const values = getValues(record);

    FILTER_FIELDS.forEach((field) => {
      const value = normalizeFilterValue(values[field.id]);

      if (!value || value === "-") {
        return;
      }

      const optionKey = normalizeComparisonValue(value);

      if (!optionMaps[field.id].has(optionKey)) {
        optionMaps[field.id].set(optionKey, {
          value,
          label: value
        });
      }
    });
  });

  return FILTER_FIELDS.reduce((options, field) => {
    options[field.id] = Array.from(optionMaps[field.id].values())
      .sort((left, right) => sortFilterOptions(field.id, left, right));
    return options;
  }, {});
}

export function toggleRecordFilterValue(filters, fieldId, value) {
  const currentValues = filters[fieldId] ?? [];
  const hasValue = currentValues.includes(value);

  return {
    ...filters,
    [fieldId]: hasValue
      ? currentValues.filter((currentValue) => currentValue !== value)
      : [...currentValues, value]
  };
}

export function matchesRecordFilters(values, filters) {
  return FILTER_FIELDS.every((field) => {
    const selectedValues = filters[field.id] ?? [];

    if (!selectedValues.length) {
      return true;
    }

    const recordValue = normalizeComparisonValue(values[field.id]);

    return selectedValues.some((selectedValue) =>
      normalizeComparisonValue(selectedValue) === recordValue
    );
  });
}

export function hasActiveRecordFilters(filters) {
  return FILTER_FIELDS.some((field) => (filters[field.id] ?? []).length > 0);
}

function getSelectedSummary(selectedCount, optionsCount) {
  if (!optionsCount) {
    return "Sin datos";
  }

  if (!selectedCount) {
    return "Todas";
  }

  return selectedCount === 1 ? "1 seleccionada" : `${selectedCount} seleccionadas`;
}

function FilterDropdown({ field, options, selectedValues, onToggle }) {
  return (
    <details className="records-filter-dropdown">
      <summary>
        <span className="records-filter-label">{field.label}</span>
        <span className="records-filter-value">
          {getSelectedSummary(selectedValues.length, options.length)}
        </span>
      </summary>
      <div className="records-filter-menu">
        {options.length ? (
          options.map((option) => (
            <label className="records-filter-option" key={option.value}>
              <input
                type="checkbox"
                checked={selectedValues.includes(option.value)}
                onChange={() => onToggle(field.id, option.value)}
              />
              <span>{option.label}</span>
            </label>
          ))
        ) : (
          <p className="records-filter-empty">{field.emptyText}</p>
        )}
      </div>
    </details>
  );
}

export function RecordFilters({
  options,
  draftFilters,
  appliedFilters,
  onToggle,
  onApply,
  onClear,
  collaboratorLabel = "Colaborador"
}) {
  const fields = FILTER_FIELDS.map((field) =>
    field.id === "collaborator" ? { ...field, label: collaboratorLabel } : field
  );
  const hasSelections = hasActiveRecordFilters(draftFilters) || hasActiveRecordFilters(appliedFilters);

  return (
    <div className="records-filters" aria-label="Filtros de registros">
      {fields.map((field) => (
        <FilterDropdown
          field={field}
          key={field.id}
          options={options[field.id] ?? []}
          selectedValues={draftFilters[field.id] ?? []}
          onToggle={onToggle}
        />
      ))}
      <button type="button" className="secondary-action filter-action" onClick={onApply}>
        Filtrar
      </button>
      {hasSelections ? (
        <button type="button" className="ghost-action filter-action" onClick={onClear}>
          Limpiar
        </button>
      ) : null}
    </div>
  );
}
