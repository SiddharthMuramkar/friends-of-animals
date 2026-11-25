import { connection } from "next/server";
import { as, currentActor } from "@/server/app";
import { DomainError } from "@/server/errors";
export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/admin/gallery/[itemId]/image">
) {
  await connection();
  const headers = {
    "Cache-Control": "private, no-store",
    "X-Robots-Tag": "noindex",
    "X-Content-Type-Options": "nosniff",
  };
  try {
    const image = await as(await currentActor()).readGalleryDraftImage({
      itemId: (await ctx.params).itemId,
    });
    if (!image.ok) return new Response(null, { status: 404, headers });
    return new Response(image.body, {
      headers: {
        ...headers,
        "Content-Type": image.contentType,
        "Content-Length": String(image.sizeBytes),
      },
    });
  } catch (error) {
    if (error instanceof DomainError)
      return new Response(null, { status: 403, headers });
    throw error;
  }
}
