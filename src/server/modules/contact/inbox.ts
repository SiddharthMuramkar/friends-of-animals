// The staff inbox (#113): list, read, assign, change status, add notes.

import type { UseCaseContext } from "../../use-cases";
import type { ContactTeam, ContactTopic } from "./domain/routing";
import type { ContactCloseReason, ContactMessageStatus } from "./domain/status";

export type Person = { id: string; name: string };

export type ContactInboxItem = {
  id: string;
  reference: string;
  topic: ContactTopic;
  team: ContactTeam;
  name: string;
  subject: string;
  status: ContactMessageStatus;
  assignee: Person | null;
  createdAt: Date;
};

export type ListContactInboxInput = {
  status?: string;
  team?: string;
  topic?: string;
  /** "me", "unassigned" or a user id. */
  assignee?: string;
};

export type ListContactInboxResult =
  | { ok: true; items: ContactInboxItem[] }
  | { ok: false; error: "invalid_input" };

export type ContactNoteView = {
  id: string;
  body: string;
  author: Person | null;
  createdAt: Date;
};

export type ContactMessageView = ContactInboxItem & {
  email: string;
  organisation: string | null;
  message: string;
  closeReason: ContactCloseReason | null;
  closedAt: Date | null;
  notes: ContactNoteView[];
  /** Who may be assigned: staff who handle the message's team. */
  assignableStaff: Person[];
};

export type GetContactMessageResult =
  | { ok: true; message: ContactMessageView }
  | { ok: false; error: "not_found" };

export type AssignContactMessageResult =
  | { ok: true; changed: boolean }
  | {
      ok: false;
      error:
        | "not_found"
        | "invalid_input"
        | "message_closed"
        | "assignee_not_allowed";
    };

export type ChangeContactMessageStatusResult =
  | { ok: true; changed: boolean }
  | {
      ok: false;
      error:
        | "not_found"
        | "invalid_input"
        | "transition_not_allowed"
        | "close_reason_required"
        | "close_reason_not_allowed";
    };

export type AddContactNoteResult =
  | { ok: true; noteId: string }
  | { ok: false; error: "not_found" | "invalid_input" };

export async function listContactInbox(
  ctx: UseCaseContext,
  input: ListContactInboxInput
): Promise<ListContactInboxResult> {
  void ctx;
  void input;
  throw new Error("not built yet");
}

export async function getContactMessage(
  ctx: UseCaseContext,
  input: { messageId: string }
): Promise<GetContactMessageResult> {
  void ctx;
  void input;
  throw new Error("not built yet");
}

export async function assignContactMessage(
  ctx: UseCaseContext,
  input: { messageId: string; assigneeId: string | null }
): Promise<AssignContactMessageResult> {
  void ctx;
  void input;
  throw new Error("not built yet");
}

export async function changeContactMessageStatus(
  ctx: UseCaseContext,
  input: { messageId: string; status: string; closeReason?: string }
): Promise<ChangeContactMessageStatusResult> {
  void ctx;
  void input;
  throw new Error("not built yet");
}

export async function addContactNote(
  ctx: UseCaseContext,
  input: { messageId: string; body: string }
): Promise<AddContactNoteResult> {
  void ctx;
  void input;
  throw new Error("not built yet");
}
