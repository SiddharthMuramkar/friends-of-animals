// What the competition form and preview say about a refusal: an alert for
// the whole form and messages against each field. Pure; the messages are
// keys in the adminCompetitions namespace, translated by the caller
// (./translate.ts).

import type {
  CreateCompetitionResult,
  KeyDateKind,
  PublishProblem,
  UpdateCompetitionResult,
} from "@/server/modules/competitions";

/** A form field, with each key date its own. */
export type FieldName =
  | "code"
  | "name"
  | "theme"
  | "welfareMessage"
  | "rules"
  | "permittedMaterials"
  | "duration"
  | "participation"
  | "disciplines"
  | "ageGroups"
  | "categories"
  | "ageCutoffDate"
  | "digitalScope"
  | "shortlistPerCategory"
  | "schoolPositions"
  | "physicalArtwork"
  | "publicDisplay"
  | "auctionPermitted"
  | `keyDates.${KeyDateKind}`;

/**
 * A message key under adminCompetitions, its ICU values, and `labels`:
 * placeholders whose values are other keys, translated first.
 */
export type Message = {
  key: string;
  values?: Record<string, number>;
  labels?: Record<string, string>;
};

export type SaveRefusal =
  | Extract<CreateCompetitionResult, { ok: false }>
  | Extract<UpdateCompetitionResult, { ok: false }>;

export type FormOutcome = {
  alert: SaveRefusal["error"];
  errors: Partial<Record<FieldName, Message[]>>;
};

const NUMBER_FIELDS: ReadonlySet<string> = new Set([
  "shortlistPerCategory",
  "schoolPositions",
  "physicalArtwork",
]);

/** The message for a field a save refused as malformed. */
function invalidFieldMessage(field: string): Message {
  if (field === "name" || field === "ageGroups" || field === "categories") {
    return { key: `errors.${field}` };
  }
  return { key: NUMBER_FIELDS.has(field) ? "errors.number" : "errors.invalid" };
}

const keyDateLabel = (kind: KeyDateKind) => `vocabulary.keyDate.${kind}`;

/** The field a publish problem belongs to, and what to say about it. */
export function problemMessage(problem: PublishProblem): {
  field: FieldName;
  message: Message;
} {
  switch (problem.field) {
    case "keyDates": {
      const field = `keyDates.${problem.kind}` as const;
      const kind = keyDateLabel(problem.kind);
      if (problem.code === "required") {
        return {
          field,
          message: { key: "problems.keyDateRequired", labels: { kind } },
        };
      }
      if (problem.code === "not_applicable") {
        return {
          field,
          message: { key: "problems.keyDateNotApplicable", labels: { kind } },
        };
      }
      // Only submissions may close at the moment registration does.
      const key =
        problem.kind === "submissions_close"
          ? "problems.keyDateNotBefore"
          : "problems.keyDateMustFollow";
      return {
        field,
        message: { key, labels: { kind, other: keyDateLabel(problem.other) } },
      };
    }
    case "ageGroups": {
      if (problem.code === "none") {
        return {
          field: "ageGroups",
          message: { key: "problems.ageGroupsNone" },
        };
      }
      const values: Record<string, number> = { row: problem.index + 1 };
      if ("other" in problem) values.other = problem.other + 1;
      return {
        field: "ageGroups",
        message: { key: `problems.${problem.code}`, values },
      };
    }
    case "categories":
      if (problem.code === "required") break;
      return {
        field: "categories",
        message: {
          key: `problems.${problem.code}`,
          values: { row: problem.index + 1 },
        },
      };
    case "shortlistPerCategory":
    case "schoolPositions":
    case "physicalArtwork": {
      const label =
        problem.field === "physicalArtwork"
          ? "physicalArtworkTopN"
          : problem.field;
      return {
        field: problem.field,
        message: {
          key: "problems.out_of_range",
          labels: { field: `form.${label}` },
        },
      };
    }
    case "ageCutoffDate":
      if (problem.code === "invalid") {
        return {
          field: "ageCutoffDate",
          message: {
            key: "problems.dateInvalid",
            labels: { field: "form.ageCutoffDate" },
          },
        };
      }
      break;
    default:
      break;
  }
  return {
    field: problem.field,
    message: {
      key: "problems.required",
      labels: { field: `form.${problem.field}` },
    },
  };
}

function add(
  errors: FormOutcome["errors"],
  field: FieldName,
  message: Message
): void {
  (errors[field] ??= []).push(message);
}

/** The alert and field messages for a save the use case refused. */
export function refusalOutcome(refusal: SaveRefusal): FormOutcome {
  const errors: FormOutcome["errors"] = {};
  switch (refusal.error) {
    case "invalid_input":
      for (const field of refusal.fields) {
        add(errors, field as FieldName, invalidFieldMessage(field));
      }
      break;
    case "invalid_date":
      for (const field of refusal.fields) {
        add(errors, field as FieldName, { key: "errors.date" });
      }
      break;
    case "invalid_code":
      add(errors, "code", { key: "errors.codeFormat" });
      break;
    case "code_taken":
      add(errors, "code", { key: "errors.codeTaken" });
      break;
    case "code_locked":
      add(errors, "code", { key: "errors.codeLocked" });
      break;
    case "not_ready":
      for (const problem of refusal.problems) {
        const { field, message } = problemMessage(problem);
        add(errors, field, message);
      }
      break;
    case "not_found":
      break;
  }
  return { alert: refusal.error, errors };
}
