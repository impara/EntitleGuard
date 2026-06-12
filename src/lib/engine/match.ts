import type {
  BillingState,
  MatchConfidence,
  MatchResult,
  MatchTier,
  MatchedPair,
  NormalizedAppRecord,
  NormalizedStripeRecord,
} from "./types";

/**
 * Tiered matching (PRD section 17). Priority:
 *   1. Stripe customer ID   -> high confidence
 *   2. Subscription ID      -> high confidence (only if app export carries it
 *                              in its stripeCustomerId column — rare; skipped
 *                              unless values look like sub_*)
 *   3. Exact email          -> high confidence
 *   4. Normalized email     -> medium confidence
 * Any key shared by multiple app records is a collision: the match is kept but
 * demoted to needs_review (the tool must not pretend uncertain matches are
 * definitive).
 */

function buildIndex(
  records: NormalizedAppRecord[],
  key: (r: NormalizedAppRecord) => string | null,
): Map<string, NormalizedAppRecord[]> {
  const index = new Map<string, NormalizedAppRecord[]>();
  for (const record of records) {
    const k = key(record);
    if (!k) continue;
    const bucket = index.get(k);
    if (bucket) bucket.push(record);
    else index.set(k, [record]);
  }
  return index;
}

const TIER_CONFIDENCE: Record<MatchTier, MatchConfidence> = {
  customer_id: "high",
  subscription_id: "high",
  email_exact: "high",
  email_normalized: "medium",
};

// ---------------------------------------------------------------------------
// Multi-subscription collapse.
//
// A Stripe export can carry several subscription rows for the same customer
// (cancel + resubscribe, plan migration, an old annual sub next to a new
// monthly one). Classifying each row independently produces false positives:
// the canceled row of a customer who also has a live subscription would be
// reported as "unpaid but active". Entitlement is a customer-level question,
// so rows are collapsed to one winner per customer — ranked, not summed.
// ---------------------------------------------------------------------------

/** PAID beats UNKNOWN beats UNPAID, so a live sub always wins and an
 *  uninterpretable status degrades to needs-review instead of a false leak. */
const STATE_RANK: Record<BillingState, number> = { PAID: 0, UNKNOWN: 1, UNPAID: 2 };

/** Finer ranking within the same billing state (lower wins). */
const RAW_STATUS_RANK: Record<string, number> = {
  active: 0,
  trialing: 1,
  paid: 2,
  current: 2,
  complete: 2,
  past_due: 0,
  "past due": 0,
  unpaid: 1,
  incomplete_expired: 2,
  trial_expired: 2,
  expired: 2,
  void: 3,
  canceled: 4,
  cancelled: 4,
};

function rawStatusRank(rawStatus: string | null): number {
  if (!rawStatus) return 99;
  return RAW_STATUS_RANK[rawStatus.trim().toLowerCase()] ?? 99;
}

function periodEndTime(record: NormalizedStripeRecord): number {
  if (!record.currentPeriodEnd) return Number.NEGATIVE_INFINITY;
  const t = Date.parse(record.currentPeriodEnd);
  return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
}

function pickWinner(
  a: NormalizedStripeRecord,
  b: NormalizedStripeRecord,
): NormalizedStripeRecord {
  const stateDiff = STATE_RANK[a.billingState] - STATE_RANK[b.billingState];
  if (stateDiff !== 0) return stateDiff < 0 ? a : b;
  const rawDiff = rawStatusRank(a.rawStatus) - rawStatusRank(b.rawStatus);
  if (rawDiff !== 0) return rawDiff < 0 ? a : b;
  const timeDiff = periodEndTime(a) - periodEndTime(b);
  if (timeDiff !== 0) return timeDiff > 0 ? a : b;
  return a.rowIndex <= b.rowIndex ? a : b;
}

/**
 * Collapse Stripe rows to one representative subscription per customer ID.
 * Rows without a customer ID pass through untouched. Output preserves the
 * file order of each customer's first appearance.
 */
export function collapseStripeRecords(
  records: NormalizedStripeRecord[],
): NormalizedStripeRecord[] {
  const winners = new Map<string, NormalizedStripeRecord>();
  for (const record of records) {
    if (!record.customerId) continue;
    const current = winners.get(record.customerId);
    winners.set(record.customerId, current ? pickWinner(current, record) : record);
  }

  const emitted = new Set<string>();
  const collapsed: NormalizedStripeRecord[] = [];
  for (const record of records) {
    if (!record.customerId) {
      collapsed.push(record);
      continue;
    }
    if (emitted.has(record.customerId)) continue;
    emitted.add(record.customerId);
    const winner = winners.get(record.customerId);
    if (winner) collapsed.push(winner);
  }
  return collapsed;
}

export function matchRecords(
  stripeRecords: NormalizedStripeRecord[],
  appRecords: NormalizedAppRecord[],
): MatchResult {
  const collapsedStripe = collapseStripeRecords(stripeRecords);
  const byCustomerId = buildIndex(appRecords, (r) => r.stripeCustomerId);
  const byExactEmail = buildIndex(appRecords, (r) => r.email?.trim().toLowerCase() ?? null);
  const byNormalizedEmail = buildIndex(appRecords, (r) => r.normalizedEmail);

  const matches: MatchedPair[] = [];
  const matchedAppRows = new Set<number>();
  const unmatchedStripe: NormalizedStripeRecord[] = [];

  for (const stripe of collapsedStripe) {
    let tier: MatchTier | null = null;
    let candidates: NormalizedAppRecord[] | undefined;

    if (stripe.customerId) {
      candidates = byCustomerId.get(stripe.customerId);
      if (candidates) tier = "customer_id";
    }
    if (!candidates && stripe.subscriptionId) {
      // Some app exports store the subscription ID in their billing reference
      // column instead of the customer ID.
      candidates = byCustomerId.get(stripe.subscriptionId);
      if (candidates) tier = "subscription_id";
    }
    if (!candidates && stripe.email) {
      candidates = byExactEmail.get(stripe.email.trim().toLowerCase());
      if (candidates) tier = "email_exact";
    }
    if (!candidates && stripe.normalizedEmail) {
      candidates = byNormalizedEmail.get(stripe.normalizedEmail);
      if (candidates) tier = "email_normalized";
    }

    if (!candidates || !tier) {
      unmatchedStripe.push(stripe);
      continue;
    }

    const collision = candidates.length > 1;
    // Deterministic pick: first record in file order.
    const app = candidates[0];
    matches.push({
      stripe,
      app,
      tier,
      confidence: collision ? "needs_review" : TIER_CONFIDENCE[tier],
      collision,
    });
    for (const candidate of candidates) {
      matchedAppRows.add(candidate.rowIndex);
    }
  }

  const unmatchedApp = appRecords.filter((r) => !matchedAppRows.has(r.rowIndex));
  return { matches, unmatchedApp, unmatchedStripe };
}
