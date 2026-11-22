import type { NextRequest, NextResponse } from "next/server";

import { publishedSlugLookup } from "@/app/competitions/_lib/public-reader";
import { createProxy } from "@/request-proxy";

// The logic lives in src/request-proxy.ts; this file wires it to the
// database and tells Next which paths it runs on.
const handle = createProxy({
  isPublishedCompetitionSlug: publishedSlugLookup,
});

export function proxy(request: NextRequest): Promise<NextResponse> {
  return handle(request);
}

export const config = {
  matcher: [
    "/blog/:slug",
    "/competitions/:slug",
    "/account",
    "/account/:path*",
    "/admin",
    "/admin/:path*",
    "/auth",
    "/auth/:path*",
    "/dashboard",
    "/dashboard/:path*",
    "/institution",
    "/institution/:path*",
    "/institutions/register",
    "/institutions/register/:path*",
  ],
};
