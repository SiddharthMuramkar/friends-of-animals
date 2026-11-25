import { connection, type NextRequest } from "next/server";

import { as, currentActor } from "@/server/app";

// An adoption photo's resized copy (#129), same-origin, so the public CSP
// needs no storage origin and no URL to the bucket leaves the server. The
// adoption module decides (readAdoptionPhoto): never the original, only a
// ready copy, to anyone while the animal's page is public and otherwise
// only to its representatives. A public copy may be cached for five
// minutes, which bounds how long it outlives a hold or withdrawal.

const PUBLIC_CACHE = "public, max-age=300, s-maxage=300";

export async function GET(
  _request: NextRequest,
  ctx: RouteContext<"/media/adoption/[photoId]/[kind]">
) {
  // Wait for a real request, so `next build` never prerenders this.
  await connection();
  const { photoId, kind } = await ctx.params;
  const result = await as(await currentActor()).readAdoptionPhoto({
    photoId,
    kind,
  });
  if (!result.ok) {
    return new Response(null, {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    });
  }
  return new Response(result.body, {
    headers: {
      "Content-Type": result.contentType,
      "Content-Length": String(result.sizeBytes),
      "Cache-Control": result.cacheable ? PUBLIC_CACHE : "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": "inline",
    },
  });
}
