"use client";
import { useId, useRef } from "react";
import { buttonStyles } from "@/components/site/button-link";
import { SubmitButton } from "@/components/form";
import { cancelMonthlyAction } from "../_lib/actions";

export function CancelForm({
  id,
  labels,
}: {
  id: string;
  labels: {
    cancel: string;
    title: string;
    body: string;
    keep: string;
    confirm: string;
    pending: string;
  };
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId();
  return (
    <>
      <button
        type="button"
        className={buttonStyles({ variant: "secondary" })}
        onClick={() => dialog.current?.showModal()}
      >
        {labels.cancel}
      </button>
      <dialog
        ref={dialog}
        aria-labelledby={title}
        className="m-auto max-w-lg w-[calc(100%-2rem)] rounded-3xl border-2 border-border bg-surface p-6 text-ink modal:overscroll-contain backdrop:bg-black/60 backdrop:overflow-hidden backdrop:overscroll-contain"
      >
        <h1 id={title} className="text-h3">
          {labels.title}
        </h1>
        <p className="mt-3">{labels.body}</p>
        <div className="mt-5 flex flex-wrap gap-3">
          <button
            type="button"
            autoFocus
            className={buttonStyles({ variant: "secondary" })}
            onClick={() => dialog.current?.close()}
          >
            {labels.keep}
          </button>
          <form
            action={async () => {
              await cancelMonthlyAction(id);
              dialog.current?.close();
            }}
          >
            <SubmitButton pendingLabel={labels.pending}>
              {labels.confirm}
            </SubmitButton>
          </form>
        </div>
      </dialog>
    </>
  );
}
