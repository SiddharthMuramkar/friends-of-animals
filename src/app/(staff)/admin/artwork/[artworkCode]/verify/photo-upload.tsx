"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { buttonStyles } from "@/components/site/button-link";
import {
  requestPhotoAction,
  completePhotoAction,
} from "../../_lib/custody-actions";

export function PhotoUpload({
  artworkId,
  code,
  labels,
}: {
  artworkId: string;
  code: string;
  labels: {
    photoKind: string;
    photoKinds: Record<"front" | "back" | "detail", string>;
    photo: string;
    upload: string;
    uploading: string;
    uploaded: string;
    uploadFailed: string;
  };
}) {
  const router = useRouter();
  const [result, action, pending] = useActionState(
    async (_previous: "uploaded" | "uploadFailed" | null, data: FormData) => {
      const file = data.get("photo");
      const kind = data.get("kind");
      if (
        !(file instanceof File) ||
        file.size === 0 ||
        (kind !== "front" && kind !== "back" && kind !== "detail")
      )
        return "uploadFailed" as const;
      try {
        const upload = await requestPhotoAction(artworkId, code, {
          kind,
          sizeBytes: file.size,
          contentType: file.type,
        });
        if (!upload.ok) return "uploadFailed" as const;
        const put = await fetch(upload.uploadUrl, {
          method: "PUT",
          body: file,
          headers: upload.headers,
        });
        if (!put.ok) return "uploadFailed" as const;
        const completed = await completePhotoAction(code, upload.fileId);
        if (!completed.ok) return "uploadFailed" as const;
        router.refresh();
        return "uploaded" as const;
      } catch {
        return "uploadFailed" as const;
      }
    },
    null
  );
  return (
    <form action={action} aria-label={labels.upload} className="space-y-4">
      <fieldset className="space-y-2">
        <legend className="font-semibold">{labels.photoKind}</legend>
        {(["front", "back", "detail"] as const).map((kind) => (
          <label key={kind} className="flex min-h-11 items-center gap-2">
            <input
              name="kind"
              type="radio"
              value={kind}
              required
              defaultChecked={kind === "front"}
            />
            {labels.photoKinds[kind]}
          </label>
        ))}
      </fieldset>
      <label className="block font-semibold" htmlFor="custody-file">
        {labels.photo}
      </label>
      <input
        className="block w-full min-h-12"
        id="custody-file"
        name="photo"
        type="file"
        accept="image/jpeg,image/png,image/heic,image/heif"
        capture="environment"
        required
      />
      <button type="submit" disabled={pending} className={buttonStyles()}>
        {labels[pending ? "uploading" : "upload"]}
      </button>
      <output className="block">{result ? labels[result] : ""}</output>
    </form>
  );
}
