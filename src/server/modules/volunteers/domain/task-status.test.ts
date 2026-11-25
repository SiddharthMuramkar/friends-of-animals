import { describe, expect, it } from "vitest";

import {
  acceptsHours,
  nextTaskStatus,
  TaskTransitionError,
  TASK_ACTIONS,
  VOLUNTEER_TASK_STATUSES,
  type TaskAction,
  type VolunteerTaskStatus,
} from "./task-status";

// The expected machine, written out by hand from the ticket: a community
// manager creates, publishes, assigns and cancels; the assigned volunteer
// starts and completes. `remaining` is how many volunteers are still
// assigned after the action. A ticket that adds a move adds its row here.
type Row = readonly [
  action: TaskAction,
  from: VolunteerTaskStatus | null,
  remaining: number,
  to: VolunteerTaskStatus,
];

const ALLOWED: readonly Row[] = [
  ["create", null, 0, "draft"],
  ["publish", "draft", 0, "open"],
  ["assign", "open", 1, "assigned"],
  // More hands on a task already under way leave its status alone.
  ["assign", "assigned", 2, "assigned"],
  ["assign", "in_progress", 2, "in_progress"],
  // Someone else is still on it.
  ["unassign", "assigned", 1, "assigned"],
  ["unassign", "in_progress", 1, "in_progress"],
  // Nobody is left, so the task needs a volunteer again.
  ["unassign", "assigned", 0, "open"],
  ["unassign", "in_progress", 0, "open"],
  ["start", "assigned", 1, "in_progress"],
  ["complete", "in_progress", 1, "done"],
  ["cancel", "draft", 0, "cancelled"],
  ["cancel", "open", 0, "cancelled"],
  ["cancel", "assigned", 1, "cancelled"],
  ["cancel", "in_progress", 1, "cancelled"],
];

const FROM: readonly (VolunteerTaskStatus | null)[] = [
  null,
  "draft",
  "open",
  "assigned",
  "in_progress",
  "done",
  "cancelled",
];

const allowedTarget = (
  action: TaskAction,
  from: VolunteerTaskStatus | null,
  remaining: number
) =>
  ALLOWED.find(
    ([a, f, r]) =>
      a === action &&
      f === from &&
      (action === "unassign" ? r > 0 === remaining > 0 : true)
  )?.[3];

describe("volunteer task statuses", () => {
  it("declares every status the schema's enum needs, in order", () => {
    expect(VOLUNTEER_TASK_STATUSES).toEqual([
      "draft",
      "open",
      "assigned",
      "in_progress",
      "done",
      "cancelled",
    ]);
  });

  it("declares every action a use case performs", () => {
    expect(TASK_ACTIONS).toEqual([
      "create",
      "publish",
      "assign",
      "unassign",
      "start",
      "complete",
      "cancel",
    ]);
  });
});

describe("nextTaskStatus", () => {
  it.each(ALLOWED)("%s from %s (%i left) -> %s", (action, from, left, to) => {
    expect(nextTaskStatus(from, action, { remainingAssignees: left })).toBe(to);
  });

  // Every action from every status, with someone left and with nobody
  // left (an assignment always leaves someone): anything the table above
  // doesn't list is refused.
  const everyMove = TASK_ACTIONS.flatMap((action) =>
    FROM.flatMap((from) =>
      (action === "assign" ? [1] : [0, 1]).map(
        (remaining) => [action, from, remaining] as const
      )
    )
  );
  const refused = everyMove.filter(
    ([action, from, remaining]) =>
      allowedTarget(action, from, remaining) === undefined
  );

  it("refuses at least the obvious wrong moves", () => {
    const has = (action: TaskAction, from: VolunteerTaskStatus | null) =>
      refused.some(([a, f]) => a === action && f === from);
    expect(has("start", "open")).toBe(true);
    expect(has("complete", "assigned")).toBe(true);
    expect(has("publish", "open")).toBe(true);
    expect(has("assign", "draft")).toBe(true);
    expect(has("cancel", "done")).toBe(true);
  });

  it.each(refused)("refuses %s from %s (%i left)", (action, from, left) => {
    expect(() =>
      nextTaskStatus(from, action, { remainingAssignees: left })
    ).toThrow(TaskTransitionError);
  });

  it("names the refused move in the error", () => {
    try {
      nextTaskStatus("done", "start", { remainingAssignees: 1 });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(TaskTransitionError);
      const refusal = error as TaskTransitionError;
      expect(refusal.from).toBe("done");
      expect(refusal.action).toBe("start");
      expect(refusal.message).toBe("A volunteer task cannot start from done");
    }
  });

  it("names a task that doesn't exist yet as (none)", () => {
    expect(() =>
      nextTaskStatus(null, "publish", { remainingAssignees: 0 })
    ).toThrow("A volunteer task cannot publish from (none)");
  });

  it("refuses an assignment that leaves nobody assigned", () => {
    expect(() =>
      nextTaskStatus("open", "assign", { remainingAssignees: 0 })
    ).toThrow(RangeError);
  });

  it("refuses a negative or fractional count of assignees", () => {
    expect(() =>
      nextTaskStatus("assigned", "unassign", { remainingAssignees: -1 })
    ).toThrow(RangeError);
    expect(() =>
      nextTaskStatus("assigned", "unassign", { remainingAssignees: 0.5 })
    ).toThrow(RangeError);
  });
});

describe("acceptsHours", () => {
  it.each([
    ["draft", false],
    ["open", false],
    ["assigned", true],
    ["in_progress", true],
    // Hours are often logged after the work is finished.
    ["done", true],
    ["cancelled", false],
  ] as const)("%s -> %s", (status, accepts) => {
    expect(acceptsHours(status)).toBe(accepts);
  });
});
