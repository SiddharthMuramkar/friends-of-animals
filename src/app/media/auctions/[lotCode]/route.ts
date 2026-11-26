import { connection } from "next/server";
import { as, currentActor } from "@/server/app";

export async function GET(
  _request: Request,
  ctx: RouteContext<"/media/auctions/[lotCode]">
) {
  await connection();
  const headers = {
    "Cache-Control": "private, no-store",
    "X-Robots-Tag": "noindex",
    "X-Content-Type-Options": "nosniff",
  };
  const image = await as(await currentActor()).readLotImage({
    lotCode: (await ctx.params).lotCode,
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
