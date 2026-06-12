import Papa from "papaparse";
import type { CsvParseResult, ParsedCsv } from "./types";

export const MAX_FILE_BYTES = 50 * 1024 * 1024; // 50MB
export const MAX_ROWS = 250_000;

/** Strip a UTF-8 BOM if present. */
function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Parse CSV text into headers + row objects. Pure string-in, data-out so it
 * works identically in the browser, a Web Worker, and node tests.
 */
export function parseCsvText(text: string, fileName: string): CsvParseResult {
  const cleaned = stripBom(text);

  if (cleaned.trim().length === 0) {
    return {
      ok: false,
      error: { code: "EMPTY_FILE", message: `${fileName} is empty.` },
    };
  }

  const result = Papa.parse<Record<string, string>>(cleaned, {
    header: true,
    skipEmptyLines: "greedy",
    delimitersToGuess: [",", ";", "\t", "|"],
    transformHeader: (h) => h.trim(),
  });

  const fatal = result.errors.filter((e) => e.type === "Delimiter");
  if (fatal.length > 0) {
    return {
      ok: false,
      error: {
        code: "PARSE_FAILED",
        message: `Could not detect a CSV delimiter in ${fileName}.`,
      },
    };
  }

  const headers = (result.meta.fields ?? []).filter((h) => h.length > 0);
  if (headers.length === 0) {
    return {
      ok: false,
      error: {
        code: "NO_HEADERS",
        message: `${fileName} has no column headers in its first row.`,
      },
    };
  }

  const rows = result.data;
  if (rows.length === 0) {
    return {
      ok: false,
      error: {
        code: "NO_ROWS",
        message: `${fileName} has headers but no data rows.`,
      },
    };
  }
  if (rows.length > MAX_ROWS) {
    return {
      ok: false,
      error: {
        code: "TOO_LARGE",
        message: `${fileName} has ${rows.length.toLocaleString()} rows; the local audit supports up to ${MAX_ROWS.toLocaleString()}.`,
      },
    };
  }

  const warnings: string[] = [];
  const fieldMismatches = result.errors.filter(
    (e) => e.code === "TooFewFields" || e.code === "TooManyFields",
  );
  if (fieldMismatches.length > 0) {
    warnings.push(
      `${fieldMismatches.length} row(s) had a different number of columns than the header; missing cells were treated as empty.`,
    );
  }
  if (headers.length !== new Set(headers).size) {
    warnings.push(
      "Duplicate column headers detected; only the last occurrence of each duplicate is used.",
    );
  }

  return {
    ok: true,
    data: {
      fileName,
      headers,
      rows,
      rowCount: rows.length,
      delimiter: result.meta.delimiter ?? ",",
      warnings,
    },
  };
}

/** Browser helper: validate size then parse a File object. */
export async function parseCsvFile(file: File): Promise<CsvParseResult> {
  if (file.size > MAX_FILE_BYTES) {
    return {
      ok: false,
      error: {
        code: "TOO_LARGE",
        message: `${file.name} is ${(file.size / 1024 / 1024).toFixed(1)}MB; the local audit supports files up to 50MB.`,
      },
    };
  }
  const text = await file.text();
  return parseCsvText(text, file.name);
}

/** Serialize rows back to CSV (used for the local mismatch export). */
export function toCsv(rows: Record<string, string | number | null>[]): string {
  return Papa.unparse(rows);
}

export type { ParsedCsv };
