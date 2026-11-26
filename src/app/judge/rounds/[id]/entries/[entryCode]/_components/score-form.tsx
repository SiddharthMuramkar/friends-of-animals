"use client";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent,
} from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { buttonStyles } from "@/components/site/button-link";
import { judgeEntryPath, judgeRoundPath } from "@/lib/app-routes";
import type {
  ScoreConflict,
  ScoreSheet,
  ScoringProgress,
} from "@/server/modules/judging/blind/domain/score-sheet";
import { saveScorePatch, submitScoreForm } from "../actions";
import {
  dirty,
  draftFromSheet,
  mergedDraft,
  patchFromDraft,
  type Draft,
} from "./score-draft";

type Criterion = {
  id: string;
  label: string;
  description: string;
  weight: number;
  minScore: number;
  maxScore: number;
};
export type SaveStatus =
  | "idle"
  | "unsaved"
  | "saving"
  | "saved"
  | "invalid"
  | "conflict"
  | "failed"
  | "closed"
  | "locked";
const editClass =
  "min-h-12 w-full rounded-xl border-2 border-border-strong bg-surface px-3 py-2 text-body text-ink";
const debounceMs = 650;

type Props = {
  roundId: string;
  entryCode: string;
  criteria: readonly Criterion[];
  sheet: ScoreSheet;
  progress: ScoringProgress;
  locked: boolean;
  previousEntryCode: string | null;
  nextEntryCode: string | null;
  initialStatus: SaveStatus;
};
export function ScoreForm({
  roundId,
  entryCode,
  criteria,
  sheet,
  progress,
  locked,
  previousEntryCode,
  nextEntryCode,
  initialStatus,
}: Props) {
  const t = useTranslations("judgeScoring"),
    router = useRouter();
  const [saved, setSaved] = useState(sheet),
    [draft, setDraft] = useState(() => draftFromSheet(criteria, sheet));
  const [status, setStatus] = useState<SaveStatus>(initialStatus),
    [currentProgress, setProgress] = useState(progress);
  const [conflicts, setConflicts] = useState<readonly ScoreConflict[]>([]);
  const savedRef = useRef(sheet),
    draftRef = useRef(draft),
    conflictRef = useRef(false);
  const pinnedCriteria = useRef(criteria);
  const formRef = useRef<HTMLFormElement>(null),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null),
    running = useRef<Promise<boolean> | null>(null);
  function clearTimer() {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }
  function schedule() {
    clearTimer();
    if (!locked && !conflictRef.current)
      timer.current = setTimeout(() => {
        void flush(false);
      }, debounceMs);
  }
  function changed(next: Draft) {
    draftRef.current = next;
    setDraft(next);
    if (!conflictRef.current) {
      setStatus("unsaved");
      schedule();
    }
  }
  function unsaved() {
    return dirty(draftRef.current, draftFromSheet(criteria, savedRef.current));
  }
  async function flush(explicit: boolean): Promise<boolean> {
    clearTimer();
    if (locked) return true;
    if (running.current) {
      const ok = await running.current;
      return ok ? flush(explicit) : false;
    }
    if (conflictRef.current && !explicit) return false;
    if (!unsaved()) {
      setStatus("saved");
      return true;
    }
    const sent = draftRef.current;
    const patch = patchFromDraft(criteria, sent, savedRef.current);
    if (!patch || !formRef.current?.checkValidity()) {
      setStatus("invalid");
      return false;
    }
    setStatus("saving");
    const flight = (async () => {
      try {
        const result = await saveScorePatch({ roundId, entryCode, ...patch });
        if (!result.ok) {
          setStatus(
            result.error === "invalid_scores" ||
              result.error === "invalid_input"
              ? "invalid"
              : result.error === "round_locked"
                ? "locked"
                : "closed"
          );
          return false;
        }
        savedRef.current = result.sheet;
        setSaved(result.sheet);
        setProgress(result.progress);
        const next = mergedDraft(
          criteria,
          draftRef.current,
          sent,
          result.sheet,
          result.conflicts
        );
        draftRef.current = next;
        setDraft(next);
        conflictRef.current = result.conflicts.length > 0;
        setConflicts(result.conflicts);
        setStatus(
          conflictRef.current ? "conflict" : unsaved() ? "unsaved" : "saved"
        );
        return !conflictRef.current;
      } catch {
        setStatus("failed");
        return false;
      }
    })();
    running.current = flight;
    const ok = await flight;
    running.current = null;
    if (ok && unsaved()) schedule();
    return ok;
  }
  function useStored() {
    clearTimer();
    conflictRef.current = false;
    setConflicts([]);
    const next = draftFromSheet(criteria, savedRef.current);
    draftRef.current = next;
    setDraft(next);
    setStatus("saved");
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void flush(true);
  }
  async function navigate(event: MouseEvent<HTMLAnchorElement>, href: string) {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)
      return;
    event.preventDefault();
    if (await flush(false)) router.push(href);
  }
  // On a document navigation, never silently abandon a draft whose save is
  // still queued or failed. Internal previous/next/back links flush first.
  useEffect(() => {
    function leaving(event: BeforeUnloadEvent) {
      if (
        dirty(
          draftRef.current,
          draftFromSheet(pinnedCriteria.current, savedRef.current)
        )
      ) {
        event.preventDefault();
        event.returnValue = "";
      }
    }
    window.addEventListener("beforeunload", leaving);
    return () => {
      window.removeEventListener("beforeunload", leaving);
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);
  const original = draftFromSheet(criteria, saved);
  const linkClass = buttonStyles({ variant: "quiet" });
  const prev = previousEntryCode
      ? judgeEntryPath(roundId, previousEntryCode)
      : null,
    next = nextEntryCode ? judgeEntryPath(roundId, nextEntryCode) : null,
    back = judgeRoundPath(roundId);
  return (
    <div className="flex flex-col gap-5">
      <h2 className="text-xl font-bold" id="score-heading">
        {t("scoreTitle")}
      </h2>
      <p>{t(locked ? "readOnly" : "scoreLead")}</p>
      <p className="font-semibold">
        {t("progress")}: {t(`status.${currentProgress}`)}
      </p>
      <form
        ref={formRef}
        action={submitScoreForm.bind(null, roundId, entryCode)}
        onSubmit={submit}
        aria-labelledby="score-heading"
        className="flex flex-col gap-5"
      >
        <input type="hidden" name="baseVersion" value={saved.version} />
        <input type="hidden" name="originalComment" value={original.comment} />
        {criteria.map((criterion) => {
          const id = `score-${criterion.id}`,
            hint = `${id}-help`;
          return (
            <div key={criterion.id} className="flex flex-col gap-2">
              <label htmlFor={id} className="font-bold">
                {criterion.label}
              </label>
              <p id={hint} className="text-sm text-ink-muted">
                {t("range", {
                  min: criterion.minScore,
                  max: criterion.maxScore,
                  weight: criterion.weight,
                })}
                {criterion.description ? ` · ${criterion.description}` : ""}
              </p>
              <input
                type="hidden"
                name={`original:${criterion.id}`}
                value={original.scores[criterion.id] ?? ""}
              />
              <input
                className={editClass}
                id={id}
                name={`score:${criterion.id}`}
                type="number"
                inputMode="numeric"
                min={criterion.minScore}
                max={criterion.maxScore}
                step={1}
                value={draft.scores[criterion.id] ?? ""}
                readOnly={locked}
                aria-describedby={hint}
                onChange={(event) =>
                  changed({
                    ...draftRef.current,
                    scores: {
                      ...draftRef.current.scores,
                      [criterion.id]: event.target.value,
                    },
                  })
                }
              />
            </div>
          );
        })}
        <div className="flex flex-col gap-2">
          <label htmlFor="score-comment" className="font-bold">
            {t("comment")}
          </label>
          <p className="text-sm text-ink-muted" id="score-comment-help">
            {t("commentHelp")}
          </p>
          <textarea
            id="score-comment"
            name="comment"
            className={editClass}
            rows={4}
            maxLength={2000}
            readOnly={locked}
            aria-describedby="score-comment-help"
            value={draft.comment}
            onChange={(event) =>
              changed({ ...draftRef.current, comment: event.target.value })
            }
          />
        </div>
        {!locked ? (
          <>
            <button
              type="submit"
              className={buttonStyles()}
              disabled={status === "saving"}
            >
              {t("save")}
            </button>
            <p aria-live="polite" className="min-h-6 font-semibold">
              {t(`saveStatus.${status}`)}
            </p>
            {conflicts.length ? (
              <div className="flex flex-col gap-3 rounded-xl border border-border-strong p-3">
                <ul className="list-disc ps-5">
                  {conflicts.map((c) =>
                    c.field === "score" ? (
                      <li key={c.criterionId}>
                        {t("conflictScore", {
                          criterion:
                            criteria.find((x) => x.id === c.criterionId)
                              ?.label ?? "",
                          value: c.current ?? t("blank"),
                        })}
                      </li>
                    ) : (
                      <li key="comment">
                        {t("conflictComment", {
                          value: c.current || t("blank"),
                        })}
                      </li>
                    )
                  )}
                </ul>
                <button
                  type="button"
                  className={buttonStyles({ variant: "secondary" })}
                  onClick={useStored}
                >
                  {t("useStored")}
                </button>
              </div>
            ) : null}
          </>
        ) : null}
      </form>
      <nav aria-label={t("entryNavigation")} className="flex flex-wrap gap-2">
        {prev ? (
          <a
            href={prev}
            className={linkClass}
            onClick={(event) => void navigate(event, prev)}
          >
            {t("previous")}
          </a>
        ) : null}
        <a
          href={back}
          className={linkClass}
          onClick={(event) => void navigate(event, back)}
        >
          {t("backToAssignments")}
        </a>
        {next ? (
          <a
            href={next}
            className={linkClass}
            onClick={(event) => void navigate(event, next)}
          >
            {t("next")}
          </a>
        ) : null}
      </nav>
    </div>
  );
}
