import { connection } from "next/server";

import { db } from "@/server/db";
import { getOrgFacts } from "@/server/modules/cms/org-facts";

import { healthResponse } from "./_lib/health-response";

// Health check for uptime monitors. What it checks and answers is in
// ./_lib/health-response.ts, which takes the database and the
// organisation facts as arguments so tests can hand it theirs.

export async function GET() {
  // With Cache Components a GET handler is prerendered when it can be. This
  // waits for a real request, so `next build` never runs the query.
  await connection();
  return healthResponse({ db, orgFacts: getOrgFacts });
}
