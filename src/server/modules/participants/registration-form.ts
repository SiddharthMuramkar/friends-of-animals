// individualRegistrationForm({ competitionSlug, forChildId? }) (#78, #81):
// what the individual register form shows for a competition: its name, the
// individual fee (or that it is free, or not set yet), the documents a
// registrant agrees to, each the exact version the competition pinned
// (#72), by id, so the ticked boxes name those versions, and who is
// registering: the member themselves (with the children they look after,
// to choose from), a teen whose login is linked, or the child named, with
// the name and date of birth the guardian gave. Null for no competition,
// or a draft. Signed-in members only, like registering itself; naming a
// child needs the guardian's link to them.

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
import { childrenOf, keptDetailsOf, subjectOf } from "./registrant";

export type IndividualRegistrationForm = {
  competition: { name: string; slug: string };
  acceptsIndividuals: boolean;
  /** Null until FOA sets it; zero for a free competition. */
  fee: Money | null;
  /**
   * The member themselves, with the children they could register instead;
   * a linked teen, or a child, with the profile's name and date of birth.
   */
  registrant:
    | { kind: "own"; children: { id: string; fullName: string }[] }
    | { kind: "linked"; fullName: string; dateOfBirth: string }
    | {
        kind: "child";
        childId: string;
        fullName: string;
        dateOfBirth: string;
      };
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
  input: { competitionSlug: string; forChildId?: string }
): Promise<IndividualRegistrationForm | null> {
  await authorize(ctx, "registration.individual.create");
  if (ctx.actor.kind !== "user") throw new Error("unreachable");
  const subject = await subjectOf(ctx, ctx.actor.userId, input.forChildId);
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
  const kept = await keptDetailsOf(ctx, subject);
  const documents = [...terms.documents];
  if (subject.kind === "child" && terms.participationDocument) {
    documents.push({
      ...terms.participationDocument,
      purpose: "participation",
      required: false,
    });
  }
  return {
    competition: { name: found.name, slug: found.slug },
    acceptsIndividuals: offeredRoutes(found.participation).includes(
      "individual"
    ),
    fee: terms.fees.individual,
    registrant:
      subject.kind === "own"
        ? {
            kind: "own",
            children: await childrenOf(ctx.db, ctx.actor.userId),
          }
        : subject.kind === "linked"
          ? { kind: "linked", ...kept! }
          : { kind: "child", childId: subject.profileId, ...kept! },
    documents: documents.map((document) => ({
      documentId: document.documentId,
      purpose: document.purpose,
      title: titles.get(document.documentId) ?? "",
      version: document.version,
      href: documentVersionPath(document.purpose, document.version),
      required: document.required,
    })),
  };
}
