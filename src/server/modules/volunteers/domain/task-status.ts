// A volunteer task's status machine (#124). A community manager creates a
// task as a draft, publishes it, assigns volunteers and can cancel it; an
// assigned volunteer starts and completes it. Pure: no imports, so the
// schema file (which loads under plain Node) can build its pgEnum from the
// tuple below.
//
// Every status is declared now, because adding an enum value later and
// using it in the same migration run fails.

export const VOLUNTEER_TASK_STATUSES = [
  "draft",
  "open",
  "assigned",
  "in_progress",
  "done",
  "cancelled",
] as const;

export type VolunteerTaskStatus = (typeof VOLUNTEER_TASK_STATUSES)[number];

/** What a use case does to a task. */
export const TASK_ACTIONS = [
  "create",
  "publish",
  "assign",
  "unassign",
  "start",
  "complete",
  "cancel",
] as const;

export type TaskAction = (typeof TASK_ACTIONS)[number];

/**
 * Which volunteers are still assigned after the action decides where an
 * unassignment lands: anyone left keeps the task where it is.
 */
type Remaining = "some" | "none" | "any";

type Transition = {
  action: TaskAction;
  /** `null` is a task that does not exist yet. */
  from: VolunteerTaskStatus | null;
  to: VolunteerTaskStatus;
  remaining: Remaining;
};

/** Every allowed move. Anything not listed is forbidden. */
export const TASK_TRANSITIONS: readonly Transition[] = [
  { action: "create", from: null, to: "draft", remaining: "any" },
  { action: "publish", from: "draft", to: "open", remaining: "any" },
  { action: "assign", from: "open", to: "assigned", remaining: "any" },
  // More hands on a task that already has some leave its status alone.
  { action: "assign", from: "assigned", to: "assigned", remaining: "any" },
  {
    action: "assign",
    from: "in_progress",
    to: "in_progress",
    remaining: "any",
  },
  { action: "unassign", from: "assigned", to: "assigned", remaining: "some" },
  {
    action: "unassign",
    from: "in_progress",
    to: "in_progress",
    remaining: "some",
  },
  // The last volunteer leaving puts the task back on offer.
  { action: "unassign", from: "assigned", to: "open", remaining: "none" },
  { action: "unassign", from: "in_progress", to: "open", remaining: "none" },
  { action: "start", from: "assigned", to: "in_progress", remaining: "any" },
  { action: "complete", from: "in_progress", to: "done", remaining: "any" },
  // Done and cancelled are final.
  { action: "cancel", from: "draft", to: "cancelled", remaining: "any" },
  { action: "cancel", from: "open", to: "cancelled", remaining: "any" },
  { action: "cancel", from: "assigned", to: "cancelled", remaining: "any" },
  { action: "cancel", from: "in_progress", to: "cancelled", remaining: "any" },
];

/** Thrown when a use case tries a move the machine forbids. */
export class TaskTransitionError extends Error {
  readonly from: VolunteerTaskStatus | null;
  readonly action: TaskAction;

  constructor(from: VolunteerTaskStatus | null, action: TaskAction) {
    super(`A volunteer task cannot ${action} from ${from ?? "(none)"}`);
    this.name = "TaskTransitionError";
    this.from = from;
    this.action = action;
  }
}

function matches(remaining: Remaining, count: number): boolean {
  if (remaining === "any") return true;
  return remaining === "some" ? count > 0 : count === 0;
}

/**
 * The status a task moves to when `action` happens to it in status
 * `from`, given how many volunteers are assigned once the action is done.
 * Throws `TaskTransitionError` for a forbidden move.
 */
export function nextTaskStatus(
  from: VolunteerTaskStatus | null,
  action: TaskAction,
  { remainingAssignees }: { remainingAssignees: number }
): VolunteerTaskStatus {
  if (!Number.isInteger(remainingAssignees) || remainingAssignees < 0) {
    throw new RangeError(
      `remainingAssignees must be a whole number of at least 0, not ${remainingAssignees}`
    );
  }
  if (action === "assign" && remainingAssignees < 1) {
    throw new RangeError("An assignment leaves at least one volunteer on it");
  }
  const transition = TASK_TRANSITIONS.find(
    (candidate) =>
      candidate.action === action &&
      candidate.from === from &&
      matches(candidate.remaining, remainingAssignees)
  );
  if (!transition) throw new TaskTransitionError(from, action);
  return transition.to;
}

/**
 * Whether volunteers may log hours against a task in `status`: once
 * someone is assigned, including after it is done, since hours are often
 * logged when the work is finished. Never on a cancelled task.
 */
export function acceptsHours(status: VolunteerTaskStatus): boolean {
  return status === "assigned" || status === "in_progress" || status === "done";
}
