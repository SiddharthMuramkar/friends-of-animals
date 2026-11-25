import { connection } from "next/server";
import { as } from "@/server/app";
import { PUBLIC_READER } from "../../../competitions/_lib/public-reader";
export async function GET(
  _request: Request,
  ctx: RouteContext<"/media/gallery/[itemId]">
) {
  await connection();
  const headers = {
    "Cache-Control": "private, no-store, max-age=0",
    "CDN-Cache-Control": "no-store",
    "X-Robots-Tag": "noindex, nofollow",
    "X-Content-Type-Options": "nosniff",
  };
  const image = await as(PUBLIC_READER).readGalleryImage({
    itemId: (await ctx.params).itemId,
  });
  if (!image.ok) return new Response(null, { status: 404, headers });
  return new Response(image.body, {
    headers: {
      ...headers,
      "Content-Type": image.contentType,
      "Content-Length": String(image.sizeBytes),
      "Content-Disposition": "inline",
    },
  });
}
