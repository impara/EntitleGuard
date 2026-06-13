"use client";

import { useState } from "react";
import {
  APP_EXPORT_TEMPLATES,
  type AppExportTemplateId,
} from "@/lib/export-sql-templates";

export function AppExportSqlHelp() {
  const [active, setActive] = useState<AppExportTemplateId>("users");
  const template = APP_EXPORT_TEMPLATES.find((t) => t.id === active)!;

  return (
    <>
      <p className="mb-2">
        Minimal export SQL — adapt table/column names to your schema. No names or emails;
        matching uses the Stripe customer ID.
      </p>
      <div className="mb-2 flex gap-1">
        {APP_EXPORT_TEMPLATES.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setActive(t.id)}
            className={`rounded-md px-2.5 py-1 text-xs font-medium ${
              active === t.id
                ? "bg-accent/20 text-accent"
                : "text-muted hover:bg-surface hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <p className="mb-2 text-xs text-muted">{template.description}</p>
      <pre className="overflow-x-auto rounded bg-black/30 p-2 font-mono text-[11px] leading-relaxed">
        {template.query}
      </pre>
      <p className="mt-2 text-xs text-muted">Postgres export:</p>
      <pre className="mt-1 overflow-x-auto rounded bg-black/30 p-2 font-mono text-[11px] leading-relaxed">
        {template.copyCommand}
      </pre>
      <p className="mt-2">
        Prisma:{" "}
        <span className="font-mono">npx prisma db execute --stdin</span> with the query above,
        or export from any admin/BI tool.
      </p>
      <p className="mt-2">
        Only add an <span className="font-mono">email</span> column if you do not store{" "}
        <span className="font-mono">stripe_customer_id</span> — email then becomes the join key,
        at lower match confidence.
      </p>
      <p className="mt-2">
        Export the access/status columns your request path <em>actually reads</em> — not
        whatever column happens to be named &quot;status&quot;. If your middleware checks a
        boolean and a cron job checks a status column, export both; the audit flags rows where
        your own columns disagree with each other.
      </p>
    </>
  );
}
