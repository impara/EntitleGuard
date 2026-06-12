"use client";

import type { MappingSuggestion } from "@/lib/engine";

export interface MappingFieldDef<F extends string> {
  field: F;
  label: string;
  required?: boolean;
  hint?: string;
}

interface ColumnMapperProps<F extends string> {
  title: string;
  fileName: string;
  headers: string[];
  fields: MappingFieldDef<F>[];
  mapping: Partial<Record<F, string>>;
  suggestions: MappingSuggestion<F>[];
  onChange: (field: F, column: string | null) => void;
}

export function ColumnMapper<F extends string>({
  title,
  fileName,
  headers,
  fields,
  mapping,
  suggestions,
  onChange,
}: ColumnMapperProps<F>) {
  const suggestionByField = new Map(suggestions.map((s) => [s.field, s]));

  return (
    <div className="rounded-xl border border-edge bg-surface p-5">
      <div className="mb-4">
        <h3 className="font-semibold">{title}</h3>
        <p className="mt-0.5 truncate font-mono text-xs text-muted">{fileName}</p>
      </div>
      <div className="space-y-3">
        {fields.map(({ field, label, required, hint }) => {
          const suggestion = suggestionByField.get(field);
          const value = mapping[field] ?? "";
          const lowConfidence =
            suggestion && value === suggestion.column && suggestion.confidence < 0.7;
          return (
            <div key={field}>
              <div className="flex items-center justify-between gap-3">
                <label
                  htmlFor={`map-${title}-${field}`}
                  className="text-sm"
                >
                  {label}
                  {required ? (
                    <span className="ml-1 text-danger" title="Required">
                      *
                    </span>
                  ) : (
                    <span className="ml-1.5 text-[10px] uppercase tracking-wide text-muted">
                      optional
                    </span>
                  )}
                </label>
                <select
                  id={`map-${title}-${field}`}
                  value={value}
                  onChange={(e) => onChange(field, e.target.value || null)}
                  className="w-48 rounded-md border border-edge bg-background px-2 py-1.5 text-sm outline-none focus:border-accent"
                >
                  <option value="">Not mapped</option>
                  {headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </div>
              {lowConfidence && (
                <p className="mt-1 text-right text-xs text-warning">
                  Auto-detected with low confidence — please verify.
                </p>
              )}
              {hint && !lowConfidence && (
                <p className="mt-1 text-right text-xs text-muted">{hint}</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
