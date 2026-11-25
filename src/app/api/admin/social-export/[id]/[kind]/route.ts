import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { as, currentActor } from "@/server/app";
import { DomainError } from "@/server/errors";
import { StorageNotConfiguredError } from "@/server/ports/storage";

export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/admin/social-export/[id]/[kind]">
) {
  await connection();
  const headers = {
    "Cache-Control": "private, no-store, max-age=0",
    "CDN-Cache-Control": "no-store",
    "X-Robots-Tag": "noindex, nofollow",
  };
  try {
    const { id, kind } = await ctx.params;
    if (kind !== "image" && kind !== "caption")
      return new Response(null, { status: 404, headers });
    const result = await as(await currentActor()).getSocialExportDownload({
      exportId: id,
    });
    if (!result.ok)
      return new Response(null, {
        status: result.error === "stamp_pending" ? 409 : 404,
        headers,
      });
    if (kind === "image")
      return new Response(null, {
        status: 302,
        headers: { ...headers, Location: result.url },
      });
    const t = await getTranslations("socialExport");
    const name = [result.credit.name, result.credit.school, result.credit.city]
      .filter(Boolean)
      .join(" · ");
    return new Response(
      `${result.caption}\n\n${t("creditDownload", { name })}\n`,
      {
        headers: {
          ...headers,
          "Content-Type": "text/plain; charset=utf-8",
          "Content-Disposition": `attachment; filename="foa-social-${id}.txt"`,
        },
      }
    );
  } catch (error) {
    if (error instanceof DomainError)
      return new Response(null, { status: 403, headers });
    if (error instanceof StorageNotConfiguredError)
      return new Response(null, { status: 503, headers });
    throw error;
  }
}
