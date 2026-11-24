"use client";

import { useId, useRef } from "react";

import { SubmitButton } from "@/components/form";
import { buttonStyles } from "@/components/site/button-link";

import { sendAnnouncementAction } from "../_lib/actions";

export function SendConfirmation({
  competitionId,
  announcementId,
  revision,
  labels,
}: {
  competitionId: string;
  announcementId: string;
  revision: number;
  labels: {
    title: string;
    count: string;
    lead: string;
    send: string;
    sending: string;
    cancel: string;
  };
}) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = `${id}-title`;
  const detailsId = `${id}-details`;

  return (
    <div>
      <button
        type="button"
        aria-haspopup="dialog"
        {...({ command: "show-modal", commandfor: id } as object)}
        onClick={() => dialog.current?.showModal()}
        className={buttonStyles()}
      >
        {labels.send}
      </button>
      <dialog
        ref={dialog}
        id={id}
        aria-labelledby={titleId}
        aria-describedby={detailsId}
        className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg overflow-y-auto overscroll-contain rounded-3xl border-2 border-border bg-surface p-6 text-ink backdrop:overflow-hidden backdrop:overscroll-contain backdrop:bg-[rgb(23_21_17/0.5)]"
      >
        <h2 id={titleId} className="text-h3">
          {labels.title}
        </h2>
        <div id={detailsId} className="mt-3 space-y-3">
          <p className="font-semibold">{labels.count}</p>
          <p>{labels.lead}</p>
        </div>
        <div className="mt-6 flex flex-wrap gap-3">
          <form method="dialog">
            <button
              type="submit"
              className={buttonStyles({ variant: "secondary" })}
            >
              {labels.cancel}
            </button>
          </form>
          <form action={sendAnnouncementAction} aria-labelledby={titleId}>
            <input type="hidden" name="competitionId" value={competitionId} />
            <input type="hidden" name="announcementId" value={announcementId} />
            <input type="hidden" name="revision" value={revision} />
            <input type="hidden" name="confirm" value="yes" />
            <SubmitButton pendingLabel={labels.sending}>
              {labels.send}
            </SubmitButton>
          </form>
        </div>
      </dialog>
    </div>
  );
}
