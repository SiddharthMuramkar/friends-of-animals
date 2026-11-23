import { describe, expect, it } from "vitest";

import {
  childConsentsView,
  type CompetitionPurposeView,
  type ConsentStates,
  type PurposeState,
} from "./child-consents";
import type { CompetitionConsentSetup, DocumentRef } from "./guardian-purposes";

const doc = (id: string, version = 1): DocumentRef => ({ id, version });

const SINCE = new Date("2026-11-20T10:00:00.000Z");

const givenOn = (document: DocumentRef): PurposeState => ({
  status: "given",
  documentId: document.id,
  documentVersion: document.version,
  since: SINCE,
});

const withdrawnFrom = (document: DocumentRef): PurposeState => ({
  status: "withdrawn",
  documentId: document.id,
  documentVersion: document.version,
  since: SINCE,
});

const NEVER: PurposeState = { status: "never" };

/** States keyed "<competition id or communications>/<purpose>"; the rest never given. */
function statesFrom(entries: Record<string, PurposeState>): ConsentStates {
  return (competitionId, purpose) =>
    entries[`${competitionId ?? "communications"}/${purpose}`] ?? NEVER;
}

const participationV1 = doc("participation-v1");
const publicDisplayV2 = doc("public-display-v2", 2);

/** Public display allowed, no auction, social media not attached. */
const artCompetition: CompetitionConsentSetup = {
  publicDisplayAllowed: true,
  auctionAllowed: false,
  attached: { participation: participationV1, public_display: publicDisplayV2 },
};

const asha = {
  firstName: "Asha",
  lastName: "Kulkarni",
  schoolName: "Green Valley School",
  city: "Pune",
};

function viewOf(
  states: ConsentStates,
  setup: CompetitionConsentSetup = artCompetition
) {
  return childConsentsView({
    child: asha,
    competitions: [
      { id: "art-2026", title: "Art for Animals 2026", setup, minor: true },
    ],
    states,
    communicationsDocument: doc("communications-v1"),
  });
}

function purposesOf(view: ReturnType<typeof viewOf>) {
  const [competition] = view.competitions;
  if (!competition) throw new Error("expected one competition");
  return competition.purposes;
}

describe("childConsentsView", () => {
  it("lists every competition purpose with what it would agree to and its state", () => {
    const view = viewOf(
      statesFrom({
        "art-2026/participation": givenOn(participationV1),
        "art-2026/display_city": givenOn(publicDisplayV2),
      })
    );

    expect(purposesOf(view)).toEqual([
      {
        purpose: "participation",
        offered: true,
        document: participationV1,
        state: givenOn(participationV1),
        counts: true,
      },
      {
        purpose: "public_display",
        offered: true,
        document: publicDisplayV2,
        state: NEVER,
        counts: false,
      },
      {
        purpose: "display_school",
        offered: true,
        document: publicDisplayV2,
        state: NEVER,
        counts: false,
      },
      {
        purpose: "display_city",
        offered: true,
        document: publicDisplayV2,
        state: givenOn(publicDisplayV2),
        counts: true,
      },
      {
        purpose: "social_media",
        offered: false,
        document: null,
        state: NEVER,
        counts: false,
      },
      {
        purpose: "auction",
        offered: false,
        document: null,
        state: NEVER,
        counts: false,
      },
    ] satisfies CompetitionPurposeView[]);
  });
});

describe("childConsentsView, what counts", () => {
  it("counts a consent only on the version the guardian would agree to now", () => {
    const view = viewOf(
      statesFrom({
        "art-2026/public_display": givenOn(doc("public-display-v1", 1)),
      })
    );

    const publicDisplay = purposesOf(view).find(
      (each) => each.purpose === "public_display"
    );
    expect(publicDisplay).toMatchObject({ offered: true, counts: false });
    expect(view.competitions[0]?.creditPreview.gallery).toBeNull();
  });

  it("previews each public use's credit from the consents that count", () => {
    const view = viewOf(
      statesFrom({
        "art-2026/public_display": givenOn(publicDisplayV2),
        "art-2026/display_city": givenOn(publicDisplayV2),
        "art-2026/display_school": withdrawnFrom(publicDisplayV2),
      })
    );

    expect(view.competitions[0]?.creditPreview).toEqual({
      gallery: { name: "Asha K.", city: "Pune" },
      results: { name: "Asha K.", city: "Pune" },
      social_media: null,
      auction: null,
    });
  });

  it("shows the communications consent apart from any competition", () => {
    const communications = doc("communications-v1");
    const view = viewOf(
      statesFrom({ "communications/communications": givenOn(communications) })
    );

    expect(view.communications).toEqual({
      document: communications,
      state: givenOn(communications),
      counts: true,
    });
  });
});
