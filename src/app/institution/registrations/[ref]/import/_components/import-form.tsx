"use client";

import { useActionState, useEffect, useRef } from "react";

import { FormAlert, inputStyles, SubmitButton } from "@/components/form";
import { buttonStyles } from "@/components/site/button-link";
import { TableScroller } from "@/components/site/table-scroller";
import { cn } from "@/lib/utils";

import { importStudentsAction } from "../_lib/actions";
import type { ImportView } from "../_lib/import-view";

export type ImportFormLabels = {
  file: { label: string; hint: string };
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
  labels,
}: {
  institutionId: string;
  reference: string;
  labels: ImportFormLabels;
}) {
  const [view, formAction] = useActionState(importStudentsAction, START);
  const result = useRef<HTMLDivElement>(null);

  // The outcome takes focus, so it is read out and the keyboard is there.
  useEffect(() => {
    if (view.step !== "idle") result.current?.focus();
  }, [view]);

  return (
    <div className="flex flex-col gap-8">
      <form action={formAction} className="flex flex-col gap-6">
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
