import type {
  AppField,
  AppMapping,
  MappingSuggestion,
  ParsedCsv,
  StripeField,
  StripeMapping,
} from "./types";

/**
 * Column auto-detection (FR2). Two signals:
 *  1. Header-name synonyms (exact match scores higher than substring match).
 *  2. Value sniffing on a sample of rows (e.g. `cus_` / `sub_` prefixes,
 *     email shapes, boolean-ish values).
 */

interface FieldHeuristic {
  /** lowercase header names considered exact synonyms */
  exact: string[];
  /** lowercase substrings that hint at the field */
  fuzzy: string[];
  /** optional value test run on sample values; returns hit ratio weight */
  valueTest?: (values: string[]) => number;
  /**
   * Only distinctive value shapes (cus_/sub_ prefixes, email syntax) may
   * establish a mapping without any header signal. Generic shapes such as
   * booleans can only confirm or demote a header match.
   */
  valueCanEstablish?: boolean;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BOOLEAN_VALUES = new Set([
  "true",
  "false",
  "1",
  "0",
  "yes",
  "no",
  "t",
  "f",
  "enabled",
  "disabled",
]);

function ratio(values: string[], test: (v: string) => boolean): number {
  const nonEmpty = values.filter((v) => v.length > 0);
  if (nonEmpty.length === 0) return 0;
  return nonEmpty.filter(test).length / nonEmpty.length;
}

const STRIPE_HEURISTICS: Record<StripeField, FieldHeuristic> = {
  customerId: {
    exact: ["customer id", "customer_id", "customer", "stripe_customer_id", "stripe customer id", "customerid", "id"],
    fuzzy: ["customer"],
    valueTest: (vs) => ratio(vs, (v) => v.startsWith("cus_")),
    valueCanEstablish: true,
  },
  email: {
    exact: ["email", "customer email", "customer_email", "email address"],
    fuzzy: ["email"],
    valueTest: (vs) => ratio(vs, (v) => EMAIL_RE.test(v)),
    valueCanEstablish: true,
  },
  subscriptionId: {
    exact: ["subscription id", "subscription_id", "subscription", "subscriptionid"],
    fuzzy: ["subscription"],
    valueTest: (vs) => ratio(vs, (v) => v.startsWith("sub_")),
    valueCanEstablish: true,
  },
  status: {
    exact: ["status", "subscription status", "subscription_status"],
    fuzzy: ["status"],
  },
  currentPeriodEnd: {
    exact: ["current period end", "current_period_end", "period end", "current period end (utc)"],
    fuzzy: ["period end", "period_end"],
  },
  cancelAtPeriodEnd: {
    exact: ["cancel at period end", "cancel_at_period_end"],
    fuzzy: ["cancel at", "cancel_at"],
  },
  plan: {
    exact: ["plan", "product", "plan name", "product name", "price", "nickname"],
    fuzzy: ["plan", "product"],
  },
  mrr: {
    exact: ["mrr", "amount", "monthly amount", "unit amount", "total", "amount due"],
    fuzzy: ["mrr", "amount", "revenue"],
  },
  currency: {
    exact: ["currency"],
    fuzzy: ["currency"],
  },
};

const APP_HEURISTICS: Record<AppField, FieldHeuristic> = {
  userId: {
    exact: ["user id", "user_id", "id", "workspace id", "workspace_id", "account id", "account_id", "userid"],
    fuzzy: ["user_id", "user id", "workspace"],
  },
  email: {
    exact: ["email", "user email", "user_email", "email address"],
    fuzzy: ["email"],
    valueTest: (vs) => ratio(vs, (v) => EMAIL_RE.test(v)),
    valueCanEstablish: true,
  },
  stripeCustomerId: {
    exact: ["stripe customer id", "stripe_customer_id", "stripe_id", "stripe id", "customer_id", "customer id", "stripe_customer"],
    fuzzy: ["stripe"],
    valueTest: (vs) => ratio(vs, (v) => v.startsWith("cus_")),
    valueCanEstablish: true,
  },
  status: {
    exact: ["status", "subscription status", "subscription_status", "account status", "account_status"],
    fuzzy: ["status"],
  },
  plan: {
    exact: ["plan", "tier", "plan name", "plan_name", "subscription plan"],
    fuzzy: ["plan", "tier"],
  },
  accessEnabled: {
    exact: ["access enabled", "access_enabled", "active", "is_active", "enabled", "has_access", "access"],
    fuzzy: ["access", "active", "enabled"],
    valueTest: (vs) => ratio(vs, (v) => BOOLEAN_VALUES.has(v.toLowerCase())),
  },
  role: {
    exact: ["role", "account type", "account_type", "user type", "user_type"],
    fuzzy: ["role", "type"],
  },
  createdAt: {
    exact: ["created at", "created_at", "created", "signup date", "signup_date"],
    fuzzy: ["created"],
  },
  lastActiveAt: {
    exact: ["last active", "last_active", "last_active_at", "last seen", "last_seen_at", "last login", "last_login"],
    fuzzy: ["last active", "last_seen", "last login", "last_login"],
  },
};

function scoreColumn(
  header: string,
  sampleValues: string[],
  heuristic: FieldHeuristic,
): number {
  const h = header.toLowerCase().trim();
  let score = 0;
  if (heuristic.exact.includes(h)) {
    score = 0.9;
  } else if (heuristic.fuzzy.some((f) => h.includes(f))) {
    score = 0.55;
  }
  if (heuristic.valueTest) {
    const valueScore = heuristic.valueTest(sampleValues);
    if (valueScore > 0.8 && (score > 0 || heuristic.valueCanEstablish)) {
      // strong value signal confirms (or, for distinctive shapes, establishes)
      score = Math.max(score, 0.6) + 0.3;
    } else if (score > 0 && valueScore < 0.1 && sampleValues.some((v) => v)) {
      // header matched but values clearly don't — demote
      score *= 0.5;
    }
  }
  return Math.min(score, 1);
}

function detectMappings<F extends string>(
  csv: ParsedCsv,
  heuristics: Record<F, FieldHeuristic>,
  priority: F[],
): { mapping: Partial<Record<F, string>>; suggestions: MappingSuggestion<F>[] } {
  const sample = csv.rows.slice(0, 50);
  const samplesByColumn = new Map<string, string[]>(
    csv.headers.map((h) => [h, sample.map((r) => (r[h] ?? "").trim())]),
  );

  const suggestions: MappingSuggestion<F>[] = [];
  const mapping: Partial<Record<F, string>> = {};
  const usedColumns = new Set<string>();

  // Assign in priority order so identifier fields claim columns first.
  for (const field of priority) {
    let best: { column: string; score: number } | null = null;
    for (const header of csv.headers) {
      if (usedColumns.has(header)) continue;
      const score = scoreColumn(
        header,
        samplesByColumn.get(header) ?? [],
        heuristics[field],
      );
      if (score >= 0.5 && (best === null || score > best.score)) {
        best = { column: header, score };
      }
    }
    if (best) {
      mapping[field] = best.column;
      usedColumns.add(best.column);
      suggestions.push({ field, column: best.column, confidence: best.score });
    }
  }

  return { mapping, suggestions };
}

export function detectStripeMapping(csv: ParsedCsv): {
  mapping: StripeMapping;
  suggestions: MappingSuggestion<StripeField>[];
} {
  return detectMappings(csv, STRIPE_HEURISTICS, [
    "customerId",
    "subscriptionId",
    "email",
    "status",
    "mrr",
    "plan",
    "currency",
    "currentPeriodEnd",
    "cancelAtPeriodEnd",
  ]);
}

export function detectAppMapping(csv: ParsedCsv): {
  mapping: AppMapping;
  suggestions: MappingSuggestion<AppField>[];
} {
  return detectMappings(csv, APP_HEURISTICS, [
    "stripeCustomerId",
    "email",
    "userId",
    "accessEnabled",
    "status",
    "plan",
    "role",
    "createdAt",
    "lastActiveAt",
  ]);
}
