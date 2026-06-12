import { NextResponse } from "next/server";
import { z } from "zod";
import { db, events } from "@/db";
import { ANALYTICS_EVENTS } from "@/lib/analytics-shared";

/**
 * Analytics events (FR10). Schema only admits scalar props — arrays/objects
 * (i.e. anything that could carry CSV rows) are rejected.
 */
const eventSchema = z.object({
  sessionId: z.string().min(1).max(64),
  name: z.enum(ANALYTICS_EVENTS),
  props: z
    .record(z.string().max(64), z.union([z.string().max(256), z.number(), z.boolean()]))
    .optional(),
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = eventSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid event payload" }, { status: 400 });
  }

  const { sessionId, name, props } = parsed.data;
  db.insert(events)
    .values({ sessionId, name, props: props ? JSON.stringify(props) : null })
    .run();

  return NextResponse.json({ ok: true });
}
