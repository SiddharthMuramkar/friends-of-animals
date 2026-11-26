"use server";

import { redirect } from "next/navigation";
import { as, currentActor } from "@/server/app";
import { adminArtworkPath, adminArtworkVerifyPath } from "@/lib/app-routes";
import type { ConditionPhotoKind } from "@/server/modules/physical-artwork/domain/custody";
import { adminCall } from "../../_lib/boundary";

const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
};

export async function verifyArtworkAction(
  artworkId: string,
  code: string,
  form: FormData
) {
  const path = adminArtworkVerifyPath(code);
  const result = await adminCall(
    async () =>
      as(await currentActor()).verifyArtwork({
        artworkId,
        checklist: {
          codeMatchesLabel: form.has("codeMatchesLabel"),
          creatorConfirmed: form.has("creatorConfirmed"),
          matchesDigital: form.has("matchesDigital"),
          consentDocumentsOk: form.has("consentDocumentsOk"),
        },
        condition: text(form, "condition"),
        conditionNotes: text(form, "conditionNotes") || null,
        widthMm: Number(text(form, "widthMm")),
        heightMm: Number(text(form, "heightMm")),
        depthMm: text(form, "depthMm") ? Number(text(form, "depthMm")) : null,
        material: text(form, "material"),
        storageLocation: text(form, "storageLocation"),
        photos: form.getAll("photo").flatMap((value) => {
          if (typeof value !== "string") return [];
          const [fileId, kind] = value.split(":");
          return fileId &&
            (kind === "front" || kind === "back" || kind === "detail")
            ? [{ fileId, kind }]
            : [];
        }),
      }),
    path
  );
  if (result.ok && result.value.ok)
    redirect(`${adminArtworkPath(code)}?result=ok`);
  redirect(
    `${path}?result=${encodeURIComponent(result.ok && "error" in result.value ? result.value.error : "error")}`
  );
}

export async function requestPhotoAction(
  artworkId: string,
  code: string,
  input: { kind: ConditionPhotoKind; contentType: string; sizeBytes: number }
) {
  const result = await adminCall(
    async () =>
      as(await currentActor()).requestArtworkPhotoUpload({
        artworkId,
        ...input,
      }),
    adminArtworkVerifyPath(code)
  );
  return result.ok && result.value.ok ? result.value : { ok: false as const };
}

export async function completePhotoAction(code: string, fileId: string) {
  const result = await adminCall(
    async () => as(await currentActor()).completeUpload({ fileId }),
    adminArtworkVerifyPath(code)
  );
  return result.ok && result.value.ok
    ? { ok: true as const }
    : { ok: false as const };
}

export async function custodyAction(
  artworkId: string,
  code: string,
  command:
    | "raise"
    | "resolve"
    | "exhibit"
    | "store"
    | "move"
    | "retain"
    | "courier"
    | "hand_over",
  form: FormData
) {
  const path = adminArtworkPath(code);
  const result = await adminCall(async () => {
    const app = as(await currentActor());
    const ref = { artworkId };
    const location = text(form, "location");
    switch (command) {
      case "raise":
        return app.raiseArtworkDiscrepancy({
          ...ref,
          reason: text(form, "reason"),
          notes: text(form, "notes"),
        });
      case "resolve":
        return app.resolveArtworkDiscrepancy({
          ...ref,
          resolution: text(form, "resolution"),
        });
      case "exhibit":
        return app.exhibitArtwork({ ...ref, location });
      case "store":
        return app.storeArtwork({ ...ref, location });
      case "move":
        return app.moveArtwork({ ...ref, location });
      case "retain":
        return app.retainArtwork(ref);
      case "courier":
        return app.recordArtworkReturn({
          ...ref,
          via: {
            method: "courier",
            courierName: text(form, "courier"),
            trackingNumber: text(form, "tracking"),
          },
        });
      case "hand_over":
        return app.recordArtworkReturn({
          ...ref,
          via: { method: "hand_over", receivedBy: text(form, "receivedBy") },
        });
    }
  }, path);
  redirect(`${path}?result=${result.ok && result.value.ok ? "ok" : "error"}`);
}
