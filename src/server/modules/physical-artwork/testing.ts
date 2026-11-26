// Seam 1 fixtures exercise the actual request, receipt and private upload paths.
import { eq } from "drizzle-orm";
import type { Actor } from "../../actor";
import { competition, entry } from "../../db/schema";
import { managerOf, signedInWith } from "../judging/testing";
import {
  individualEntryAtFoa,
  signedInVerifier,
} from "../verification/testing";
import type { Harness } from "@/test/harness";

export async function receivedArtwork(h: Harness) {
  const individual = await individualEntryAtFoa(h);
  const [row] = await h.db
    .select()
    .from(entry)
    .where(eq(entry.id, individual.entryId));
  const competitionId = row!.competitionId;
  await h.db
    .update(competition)
    .set({ physicalArtwork: "all_shortlisted" })
    .where(eq(competition.id, competitionId));
  const verifier = await signedInVerifier(h);
  const manager = await signedInWith(h, managerOf(competitionId));
  const verified = await h
    .as(verifier)
    .verifyEntry({ entryId: individual.entryId });
  if (!verified.ok) throw new Error("Digital verification failed");
  const requested = await h
    .as(manager)
    .requestPhysicalArtwork({ competitionId, entryIds: [individual.entryId] });
  if (!requested.ok) throw new Error("Artwork request failed");
  const { artworkId, artworkCode } = requested.artworks[0]!;
  const receipt = await h.as(verifier).markArtworkReceived({ artworkId });
  if (!receipt.ok) throw new Error("Artwork receipt failed");
  return {
    individual,
    competitionId,
    verifier,
    manager,
    artworkId,
    artworkCode,
  };
}

export async function conditionPhotos(
  h: Pick<Harness, "as" | "storage" | "drain">,
  verifier: Actor,
  artworkId: string
) {
  const photos = [];
  for (const kind of ["front", "back"] as const) {
    const bytes = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jX7cAAAAASUVORK5CYII=",
      "base64"
    );
    const requested = await h.as(verifier).requestArtworkPhotoUpload({
      artworkId,
      kind,
      sizeBytes: bytes.length,
      contentType: "image/png",
    });
    if (!requested.ok) throw new Error(JSON.stringify(requested));
    await h.storage.put(requested.uploadUrl, bytes, requested.headers);
    const completed = await h
      .as(verifier)
      .completeUpload({ fileId: requested.fileId });
    if (!completed.ok) throw new Error(JSON.stringify(completed));
    photos.push({ fileId: requested.fileId, kind });
  }
  await h.drain();
  return photos;
}

export const verificationDetails = {
  checklist: {
    codeMatchesLabel: true,
    creatorConfirmed: true,
    matchesDigital: true,
    consentDocumentsOk: true,
  },
  condition: "good",
  conditionNotes: null,
  widthMm: 297,
  heightMm: 420,
  depthMm: null,
  material: "Watercolour on paper",
  storageLocation: "Rack B, Shelf 2",
};
