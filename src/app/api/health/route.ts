import { sql } from "drizzle-orm";
import { connection } from "next/server";

import { appEnv } from "@/lib/site";
import { db } from "@/server/db";
import { missingOrgFacts } from "@/server/cms/domain/org-facts";
import { getOrgFacts } from "@/server/cms/org-facts";

// Health check for uptime monitors. Today it checks the database; the
// queue and worker heartbeat join it with the worker. In production it
// also says whether FOA's organisation facts are all entered, without
// naming the missing ones (this answer is public; staff see them in the
// admin shell).

/** Monitors and CDNs must never see a cached answer. */
const headers = { "Cache-Control": "no-store" };

async function factsReadiness(): Promise<{ facts?: string }> {
  if (appEnv() !== "production") return {};
  const missing = missingOrgFacts(await getOrgFacts());
  return { facts: missing.length > 0 ? "incomplete" : "complete" };
}

export async function GET() {
  // With Cache Components a GET handler is prerendered when it can be. This
  // waits for a real request, so `next build` never runs the query.
  await connection();

  const started = performance.now();
  try {
    await db.execute(sql`select 1`);
  } catch (error) {
    // The details stay in the server logs; the response doesn't leak them.
    console.error("Health check: the database query failed.", error);
    return Response.json(
      { status: "error", db: { ok: false } },
      { status: 503, headers }
    );
  }
  const ms = Math.round(performance.now() - started);
  return Response.json(
    { status: "ok", db: { ok: true, ms }, ...(await factsReadiness()) },
    { headers }
  );
}
