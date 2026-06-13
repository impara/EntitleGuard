/** Minimal app export SQL — no names or emails; adapt table/column names to your schema. */

export type AppExportTemplateId = "users" | "workspaces";

export interface AppExportTemplate {
  id: AppExportTemplateId;
  label: string;
  description: string;
  query: string;
  copyCommand: string;
}

export const APP_EXPORT_TEMPLATES: AppExportTemplate[] = [
  {
    id: "users",
    label: "Users table",
    description: "Per-user billing — one row per account with a Stripe customer ID.",
    query: `SELECT
  id AS internal_user_id,
  stripe_customer_id,
  subscription_status,
  plan,
  access_enabled
FROM users;`,
    copyCommand: `\\copy (
  SELECT id AS internal_user_id, stripe_customer_id,
         subscription_status, plan, access_enabled
  FROM users
) TO 'app-users.csv' WITH CSV HEADER;`,
  },
  {
    id: "workspaces",
    label: "Workspaces table",
    description: "Workspace billing — one row per team/org with a Stripe customer ID.",
    query: `SELECT
  id AS workspace_id,
  stripe_customer_id,
  subscription_status,
  plan,
  access_enabled
FROM workspaces;`,
    copyCommand: `\\copy (
  SELECT id AS workspace_id, stripe_customer_id,
         subscription_status, plan, access_enabled
  FROM workspaces
) TO 'app-workspaces.csv' WITH CSV HEADER;`,
  },
];

export function getAppExportTemplate(id: AppExportTemplateId): AppExportTemplate {
  const template = APP_EXPORT_TEMPLATES.find((t) => t.id === id);
  if (!template) throw new Error(`Unknown export template: ${id}`);
  return template;
}
