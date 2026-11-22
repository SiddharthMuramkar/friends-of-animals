// individualRegistrationForm({ competitionSlug }) (#78): what the individual
// register form shows for a competition: its name, the individual fee (or
// that it is free, or not set yet) and the documents a registrant agrees
// to, each the exact version the competition pinned (#72), by id, so the
// ticked boxes name those versions. Null for no competition, or a draft.
// Signed-in members only, like registering itself.

import { eq } from "drizzle-orm";
import { z } from "zod";

import { authorize } from "../../access/can";
import { competition } from "../../db/schema";
import type { Money } from "../../ports/payment-gateway";
import type { UseCaseContext } from "../../use-cases";
import type { AttachablePurpose } from "../competitions/domain/consent-attachments";
import { documentVersionPath } from "../competitions/domain/consent-attachments";
import { offeredRoutes } from "../competitions/domain/fees";
import { getRegistrationTerms } from "../competitions/terms/read";
import { pinnedDocuments } from "../competitions/terms/repository";
import { COMPETITION_SLUG_PATTERN } from "./register-input";

export type IndividualRegistrationForm = {
  competition: { name: string; slug: string };
  acceptsIndividuals: boolean;
  /** Null until FOA sets it; zero for a free competition. */
  fee: Money | null;
  documents: {
    documentId: string;
    purpose: AttachablePurpose;
    title: string;
    version: number;
    href: string;
    required: boolean;
  }[];
};

const formInput = z.object({
  competitionSlug: z.string().regex(COMPETITION_SLUG_PATTERN),
});

export async function individualRegistrationForm(
  ctx: UseCaseContext,
  input: { competitionSlug: string }
): Promise<IndividualRegistrationForm | null> {
  await authorize(ctx, "registration.individual.create");
  const parsed = formInput.safeParse(input);
  if (!parsed.success) return null;
  const [found] = await ctx.db
    .select({
      id: competition.id,
      name: competition.name,
      slug: competition.slug,
      status: competition.status,
      participation: competition.participation,
    })
    .from(competition)
    .where(eq(competition.slug, parsed.data.competitionSlug));
  if (!found || found.status === "draft") return null;
  const terms = await getRegistrationTerms(ctx.db, found.id);
  if (!terms) return null;
  const titles = new Map(
    (await pinnedDocuments(ctx.db, found.id)).map((pinned) => [
      pinned.id,
      pinned.title,
    ])
  );
  return {
    competition: { name: found.name, slug: found.slug },
    acceptsIndividuals: offeredRoutes(found.participation).includes(
      "individual"
    ),
    fee: terms.fees.individual,
    documents: terms.documents.map((document) => ({
      documentId: document.documentId,
      purpose: document.purpose,
      title: titles.get(document.documentId) ?? "",
      version: document.version,
      href: documentVersionPath(document.purpose, document.version),
      required: document.required,
    })),
  };
}
