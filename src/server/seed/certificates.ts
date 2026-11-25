import { eq } from "drizzle-orm";
import { certificate } from "../db/schema";
import { issueCertificates } from "../modules/certificates/issue";
import { renderCertificate } from "../modules/certificates/render";
import { publishedResults } from "../modules/results/read-published";
import { gotenbergPdfRenderer } from "../ports/pdf-gotenberg";
import { seedFilesLocation } from "./files";
import { SEED_RESULTS } from "./results";
import type { Seeder } from "./types";
export const seedCertificates: Seeder = async (deps) => {
  const release = await publishedResults(deps.db, SEED_RESULTS.competitionId);
  if (!release || release.releaseId !== SEED_RESULTS.releaseId) return;
  const actor = { kind: "system", process: "seed" } as const;
  await issueCertificates(
    { ...deps, actor },
    {
      competitionId: release.competitionId,
      releaseId: release.releaseId,
      publishedAt: release.publishedAt.toISOString(),
    }
  );
  // No fake PDF or provider calls in preview: the media worker drains the
  // render jobs normally. A dedicated local renderer can also fill them for E2E.
  const baseUrl = process.env.GOTENBERG_URL;
  if (
    process.env.APP_ENV !== "local" ||
    !baseUrl ||
    !deps.storage ||
    !process.env.APP_URL
  )
    return;
  const rows = await deps.db
    .select()
    .from(certificate)
    .where(eq(certificate.sourceReleaseId, release.releaseId));
  for (const row of rows)
    if (row.renderStatus === "pending")
      await renderCertificate(
        {
          ...deps,
          actor,
          auth: { baseUrl: process.env.APP_URL },
          files: seedFilesLocation(),
          storage: deps.storage,
          pdf: gotenbergPdfRenderer({ baseUrl }),
        },
        { certificateId: row.id }
      );
};
