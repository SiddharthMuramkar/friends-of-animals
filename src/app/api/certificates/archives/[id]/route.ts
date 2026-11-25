import { connection } from "next/server";
import { as, currentActor } from "@/server/app";
import { DomainError } from "@/server/errors";
import { StorageNotConfiguredError } from "@/server/ports/storage";
export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/certificates/archives/[id]">
) {
  await connection();
  const headers = {
    "Cache-Control": "private, no-store",
    "X-Robots-Tag": "noindex",
  };
  try {
    const result = await as(
      await currentActor()
    ).getInstitutionCertificateArchiveLink({
      archiveId: (await ctx.params).id,
    });
    return result.ok
      ? new Response(null, {
          status: 302,
          headers: { ...headers, Location: result.url },
        })
      : new Response(null, { status: 409, headers });
  } catch (error) {
    if (error instanceof DomainError && error.code === "forbidden")
      return new Response(null, { status: 403, headers });
    if (error instanceof StorageNotConfiguredError)
      return new Response(null, { status: 503, headers });
    throw error;
  }
}
