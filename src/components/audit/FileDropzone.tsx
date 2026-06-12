"use client";

import { useCallback, useRef, useState } from "react";
import type { ParsedCsv } from "@/lib/engine";

interface FileDropzoneProps {
  title: string;
  description: string;
  csv: ParsedCsv | null;
  exportHelp: { label: string; content: React.ReactNode };
  onFile: (file: File) => void;
  onClear: () => void;
}

export function FileDropzone({
  title,
  description,
  csv,
  exportHelp,
  onFile,
  onClear,
}: FileDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) onFile(file);
    },
    [onFile],
  );

  return (
    <div className="rounded-xl border border-edge bg-surface p-5">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">{title}</h3>
          <p className="mt-1 text-sm text-muted">{description}</p>
        </div>
        {csv && (
          <span className="rounded-full bg-accent/10 px-2.5 py-0.5 text-xs font-medium text-accent">
            Loaded
          </span>
        )}
      </div>

      {csv ? (
        <div className="rounded-lg border border-edge bg-background/60 p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate font-mono text-sm">{csv.fileName}</p>
            <button
              type="button"
              onClick={onClear}
              className="shrink-0 text-xs text-muted underline-offset-2 hover:text-foreground hover:underline"
            >
              Replace
            </button>
          </div>
          <p className="mt-2 text-xs text-muted">
            {csv.rowCount.toLocaleString()} rows · {csv.headers.length} columns detected
          </p>
          <p className="mt-1 truncate text-xs text-muted" title={csv.headers.join(", ")}>
            {csv.headers.slice(0, 6).join(", ")}
            {csv.headers.length > 6 ? ", …" : ""}
          </p>
          {csv.warnings.map((w) => (
            <p key={w} className="mt-2 text-xs text-warning">
              {w}
            </p>
          ))}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          className={`flex w-full flex-col items-center justify-center rounded-lg border border-dashed px-4 py-10 text-center transition-colors ${
            dragOver
              ? "border-accent bg-accent/5"
              : "border-edge bg-background/40 hover:border-accent/50"
          }`}
        >
          <span className="text-sm font-medium">Drop a .csv here or click to browse</span>
          <span className="mt-1 text-xs text-muted">
            Up to 50MB. The file never leaves your browser.
          </span>
        </button>
      )}

      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
          e.target.value = "";
        }}
      />

      <button
        type="button"
        onClick={() => setHelpOpen((v) => !v)}
        className="mt-3 text-xs text-accent underline-offset-2 hover:underline"
      >
        {helpOpen ? "Hide" : "Show"}: {exportHelp.label}
      </button>
      {helpOpen && (
        <div className="mt-2 rounded-lg border border-edge bg-background/60 p-3 text-xs leading-relaxed text-muted">
          {exportHelp.content}
        </div>
      )}
    </div>
  );
}
