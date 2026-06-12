import type {
  AppField,
  AppMapping,
  AuditResult,
  MappingSuggestion,
  ParsedCsv,
  ProgressUpdate,
  StripeField,
  StripeMapping,
} from "@/lib/engine";

export type WizardStep = "upload" | "mapping" | "running" | "results";

export interface WizardState {
  step: WizardStep;
  stripeCsv: ParsedCsv | null;
  appCsv: ParsedCsv | null;
  stripeMapping: StripeMapping;
  appMapping: AppMapping;
  stripeSuggestions: MappingSuggestion<StripeField>[];
  appSuggestions: MappingSuggestion<AppField>[];
  fallbackValue: string;
  progress: ProgressUpdate | null;
  result: AuditResult | null;
  error: string | null;
  leadSubmitted: boolean;
  isDemo: boolean;
}

export const initialWizardState: WizardState = {
  step: "upload",
  stripeCsv: null,
  appCsv: null,
  stripeMapping: {},
  appMapping: {},
  stripeSuggestions: [],
  appSuggestions: [],
  fallbackValue: "",
  progress: null,
  result: null,
  error: null,
  leadSubmitted: false,
  isDemo: false,
};

export type WizardAction =
  | {
      type: "STRIPE_CSV_LOADED";
      csv: ParsedCsv;
      mapping: StripeMapping;
      suggestions: MappingSuggestion<StripeField>[];
    }
  | {
      type: "APP_CSV_LOADED";
      csv: ParsedCsv;
      mapping: AppMapping;
      suggestions: MappingSuggestion<AppField>[];
    }
  | { type: "CLEAR_STRIPE_CSV" }
  | { type: "CLEAR_APP_CSV" }
  | { type: "GO_TO_MAPPING" }
  | { type: "BACK_TO_UPLOAD" }
  | { type: "SET_STRIPE_FIELD"; field: StripeField; column: string | null }
  | { type: "SET_APP_FIELD"; field: AppField; column: string | null }
  | { type: "SET_FALLBACK_VALUE"; value: string }
  | { type: "RUN_STARTED" }
  | { type: "PROGRESS"; update: ProgressUpdate }
  | { type: "RESULT"; result: AuditResult }
  | { type: "ERROR"; message: string }
  | { type: "LEAD_SUBMITTED" }
  | { type: "MARK_DEMO" }
  | { type: "RESET" };

export function wizardReducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case "STRIPE_CSV_LOADED":
      return {
        ...state,
        stripeCsv: action.csv,
        stripeMapping: action.mapping,
        stripeSuggestions: action.suggestions,
        error: null,
      };
    case "APP_CSV_LOADED":
      return {
        ...state,
        appCsv: action.csv,
        appMapping: action.mapping,
        appSuggestions: action.suggestions,
        error: null,
      };
    case "CLEAR_STRIPE_CSV":
      return { ...state, stripeCsv: null, stripeMapping: {}, stripeSuggestions: [] };
    case "CLEAR_APP_CSV":
      return { ...state, appCsv: null, appMapping: {}, appSuggestions: [] };
    case "GO_TO_MAPPING":
      return { ...state, step: "mapping", error: null };
    case "BACK_TO_UPLOAD":
      return { ...state, step: "upload" };
    case "SET_STRIPE_FIELD": {
      const mapping = { ...state.stripeMapping };
      if (action.column === null) delete mapping[action.field];
      else mapping[action.field] = action.column;
      return { ...state, stripeMapping: mapping };
    }
    case "SET_APP_FIELD": {
      const mapping = { ...state.appMapping };
      if (action.column === null) delete mapping[action.field];
      else mapping[action.field] = action.column;
      return { ...state, appMapping: mapping };
    }
    case "SET_FALLBACK_VALUE":
      return { ...state, fallbackValue: action.value };
    case "RUN_STARTED":
      return { ...state, step: "running", progress: null, result: null, error: null };
    case "PROGRESS":
      return { ...state, progress: action.update };
    case "RESULT":
      return { ...state, step: "results", result: action.result, progress: null };
    case "ERROR":
      return { ...state, step: "mapping", error: action.message, progress: null };
    case "LEAD_SUBMITTED":
      return { ...state, leadSubmitted: true };
    case "MARK_DEMO":
      return { ...state, isDemo: true };
    case "RESET":
      return initialWizardState;
    default:
      return state;
  }
}

/** Minimum viable mapping (FR3): identifiers + statuses on both sides. */
export function mappingValidation(state: WizardState): {
  canRun: boolean;
  blockers: string[];
  warnings: string[];
} {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const s = state.stripeMapping;
  const a = state.appMapping;

  if (!s.customerId && !s.email) {
    blockers.push("Map at least one Stripe identifier (customer ID or email).");
  }
  if (!s.status) {
    blockers.push("Map the Stripe subscription status column.");
  }
  if (!a.stripeCustomerId && !a.email) {
    blockers.push("Map at least one app identifier (Stripe customer ID or email).");
  }
  if (!a.accessEnabled && !a.status) {
    blockers.push("Map an app access flag or status column.");
  }

  if (!s.customerId && s.email) {
    warnings.push("No Stripe customer ID mapped — matching falls back to email with lower confidence.");
  }
  if (!a.stripeCustomerId && a.email) {
    warnings.push("No Stripe customer ID in your app export — matching falls back to email with lower confidence.");
  }
  if (!s.mrr && !state.fallbackValue) {
    warnings.push("No MRR/amount column mapped and no fallback value set — leakage will be reported as account counts only.");
  }
  if (!a.plan) {
    warnings.push("Mapping the app plan column improves free-account detection.");
  }

  return { canRun: blockers.length === 0, blockers, warnings };
}
