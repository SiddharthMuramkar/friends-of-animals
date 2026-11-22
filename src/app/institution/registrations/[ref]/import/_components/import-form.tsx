"use client";

import { useActionState, useEffect, useRef, useState } from "react";

import { FormAlert, inputStyles, SubmitButton } from "@/components/form";
import { buttonStyles } from "@/components/site/button-link";
import { TableScroller } from "@/components/site/table-scroller";
import { cn } from "@/lib/utils";

import { importStudentsAction } from "../_lib/actions";
import type { ImportView } from "../_lib/import-view";

export type ImportFormLabels = {
  file: { label: string; hint: string };
  /** Said for a file over the size limit, which isn't sent. */
  tooLarge: string;
  submit: string;
  submitting: string;
  /** common.callout words: meaning never by colour alone. */
  problem: string;
  success: string;
  result: {
    title: string;
    row: string;
    student: string;
    problems: string;
    download: string;
    downloadHint: string;
  };
};

const START: ImportView = { step: "idle" };

/** The report's file name. */
const REPORT_NAME = "students-to-fix.csv";

/**
 * Saves the report, built by the server, as a file: nothing is kept on the
 * server to download it from later.
 */
function saveReport(report: string) {
  const url = URL.createObjectURL(
    new Blob([report], { type: "text/csv;charset=utf-8" })
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = REPORT_NAME;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * The upload and what came of it: a summary, the rows not enrolled with
 * what to fix, and those rows as a file to fix and upload again. Every
 * message comes translated from the action; static words come in
 * `labels`.
 */
export function ImportForm({
  institutionId,
  reference,
  maxBytes,
  labels,
}: {
  institutionId: string;
  reference: string;
  /** The largest file the import reads. */
  maxBytes: number;
  labels: ImportFormLabels;
}) {
  const [actionView, formAction] = useActionState(importStudentsAction, START);
  // How many times in a row a file over the limit was refused here, before
  // sending it: Next refuses a Server Action body over 1 MB before the
  // action runs, so the action couldn't say why.
  const [tooLarge, setTooLarge] = useState(0);
  const view: ImportView =
    tooLarge > 0 ? { step: "refused", alert: labels.tooLarge } : actionView;
  const result = useRef<HTMLDivElement>(null);

  // The outcome takes focus, so it is read out and the keyboard is there.
  useEffect(() => {
    if (tooLarge > 0 || actionView.step !== "idle") result.current?.focus();
  }, [actionView, tooLarge]);

  return (
    <div className="flex flex-col gap-8">
      <form
        action={formAction}
        onSubmit={(event) => {
          const file = new FormData(event.currentTarget).get("file");
          if (file instanceof File && file.size > maxBytes) {
            // Stops the action as well as the browser's own submit.
            event.preventDefault();
            setTooLarge((count) => count + 1);
          } else {
            setTooLarge(0);
          }
        }}
        className="flex flex-col gap-6"
      >
        <input type="hidden" name="institutionId" value={institutionId} />
        <input type="hidden" name="reference" value={reference} />
        <div className="flex flex-col gap-2">
          <label htmlFor="file" className="font-semibold text-ink">
            {labels.file.label}
          </label>
          <p id="file-hint" className="text-sm text-ink-muted">
            {labels.file.hint}
          </p>
          <input
            id="file"
            name="file"
            type="file"
            accept=".csv,text/csv"
            aria-describedby="file-hint"
            className={cn(
              inputStyles,
              "file:me-4 file:rounded-full file:border-0 file:bg-surface-muted file:px-4 file:py-1 file:font-semibold file:text-ink"
            )}
          />
        </div>
        <div>
          <SubmitButton pendingLabel={labels.submitting}>
            {labels.submit}
          </SubmitButton>
        </div>
      </form>

      {view.step === "idle" ? null : (
        <div
          ref={result}
          tabIndex={-1}
          className="flex flex-col gap-6 outline-none"
        >
          {view.step === "refused" ? (
            <FormAlert tone="danger" label={labels.problem}>
              <p>{view.alert}</p>
            </FormAlert>
          ) : (
            <>
              <FormAlert
                tone={view.tone}
                label={
                  view.tone === "success" ? labels.success : labels.problem
                }
              >
                <p>{view.summary}</p>
                {view.ignored ? <p className="mt-2">{view.ignored}</p> : null}
              </FormAlert>
              {view.rows.length > 0 ? (
                <ProblemRows view={view} labels={labels.result} />
              ) : null}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ProblemRows({
  view,
  labels,
}: {
  view: Extract<ImportView, { step: "done" }>;
  labels: ImportFormLabels["result"];
}) {
  const { report } = view;
  return (
    <div className="flex flex-col gap-4">
      <TableScroller captionId="rows-not-enrolled">
        <table className="w-full text-left">
          <caption
            id="rows-not-enrolled"
            className="px-5 pt-4 text-left font-display text-lead font-semibold text-ink"
          >
            {labels.title}
          </caption>
          <thead className="text-sm">
            <tr>
              <th scope="col" className="px-5 py-3">
                {labels.row}
              </th>
              <th scope="col" className="px-5 py-3">
                {labels.student}
              </th>
              <th scope="col" className="px-5 py-3">
                {labels.problems}
              </th>
            </tr>
          </thead>
          <tbody>
            {view.rows.map((row) => (
              <tr
                key={row.rowNumber}
                className="border-t border-border align-top"
              >
                <th scope="row" className="px-5 py-4 font-semibold">
                  {row.rowNumber}
                </th>
                <td className="px-5 py-4 wrap-anywhere">{row.name}</td>
                <td className="px-5 py-4">
                  <ul className="flex flex-col gap-1">
                    {row.problems.map((problem) => (
                      <li key={problem} className="wrap-anywhere">
                        {problem}
                      </li>
                    ))}
                  </ul>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroller>
      {report ? (
        <div className="flex flex-col gap-2">
          <p className="text-ink-muted">{labels.downloadHint}</p>
          <div>
            <button
              type="button"
              onClick={() => saveReport(report)}
              className={buttonStyles({ variant: "secondary" })}
            >
              {labels.download}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
