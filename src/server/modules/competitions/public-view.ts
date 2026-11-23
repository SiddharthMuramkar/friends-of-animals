// What the public pages show of a competition. Preview and the public read
// model both build it here, so a manager's preview can't drift from the
// page visitors get. Loads under plain Node: relative imports only.

import type { AgeGroupInput } from "./domain/age-groups";
import { orderedKeyDates, type KeyDateKind } from "./domain/key-dates";
import type { CategoryInput } from "./domain/publish-rules";
import type {
  CompetitionStatus,
  DigitalScope,
  Discipline,
  Participation,
  PhysicalArtwork,
} from "./domain/vocabulary";
import type { CompetitionValues } from "./fields";

/** A competition as visitors see it: every field publishing requires. */
export type PublicCompetition = {
  id: string;
  code: string;
  slug: string;
  name: string;
  theme: string;
  welfareMessage: string;
  /** Any status after draft; #71 adds the ones that follow publishing. */
  status: Exclude<CompetitionStatus, "draft">;
  participation: Participation;
  disciplines: Discipline[];
  /** In the manager's order. */
  ageGroups: AgeGroupInput[];
  /** By discipline, then age group, which `ageGroup` names by label. */
  categories: CategoryInput[];
  /** YYYY-MM-DD; ages are whole years on this date. */
  ageCutoffDate: string;
  rules: string;
  permittedMaterials: string;
  duration: string;
  digitalScope: DigitalScope;
  shortlistPerCategory: number;
  schoolPositions: number;
  physicalArtwork: PhysicalArtwork;
  publicDisplay: boolean;
  auctionPermitted: boolean;
  /** The dates that are set, in timeline order. */
  keyDates: { kind: KeyDateKind; at: Date }[];
  publishedAt: Date;
};

/**
 * The public view of a competition, or null if a field publishing
 * requires is missing (publishing and editing refuse that, so a stored
 * published competition always has one).
 */
export function toPublicCompetition(
  identity: {
    id: string;
    slug: string;
    status: PublicCompetition["status"];
    publishedAt: Date;
  },
  values: CompetitionValues
): PublicCompetition | null {
  const {
    theme,
    welfareMessage,
    rules,
    permittedMaterials,
    duration,
    participation,
    ageCutoffDate,
  } = values;
  if (
    theme === null ||
    welfareMessage === null ||
    rules === null ||
    permittedMaterials === null ||
    duration === null ||
    participation === null ||
    ageCutoffDate === null
  ) {
    return null;
  }
  return {
    id: identity.id,
    code: values.code,
    slug: identity.slug,
    name: values.name,
    theme,
    welfareMessage,
    status: identity.status,
    participation,
    disciplines: [...values.disciplines],
    ageGroups: values.ageGroups.map((group) => ({ ...group })),
    categories: values.categories.map((category) => ({ ...category })),
    ageCutoffDate,
    rules,
    permittedMaterials,
    duration,
    digitalScope: values.digitalScope,
    shortlistPerCategory: values.shortlistPerCategory,
    schoolPositions: values.schoolPositions,
    physicalArtwork: { ...values.physicalArtwork },
    publicDisplay: values.publicDisplay,
    auctionPermitted: values.auctionPermitted,
    keyDates: orderedKeyDates(values.keyDates),
    publishedAt: identity.publishedAt,
  };
}
