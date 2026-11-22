// The contact inbox (#113): the public contact form, routed by topic to a
// staff team. Its use cases join `as(actor)` through `contactUseCases`.

import type { UseCaseContext } from "../../use-cases";
import {
  addContactNote,
  assignContactMessage,
  changeContactMessageStatus,
  getContactMessage,
  listContactInbox,
  type ListContactInboxInput,
} from "./inbox";
import { submitContactMessage, type SubmitContactMessageInput } from "./submit";

export type {
  AddContactNoteResult,
  AssignContactMessageResult,
  ChangeContactMessageStatusResult,
  ContactInboxItem,
  ContactMessageView,
  ContactNoteView,
  GetContactMessageResult,
  ListContactInboxInput,
  ListContactInboxResult,
  Person,
} from "./inbox";
export type {
  SubmitContactMessageInput,
  SubmitContactMessageResult,
} from "./submit";

export const contactUseCases = (ctx: UseCaseContext) => ({
  submitContactMessage: (input: SubmitContactMessageInput) =>
    submitContactMessage(ctx, input),
  listContactInbox: (input: ListContactInboxInput = {}) =>
    listContactInbox(ctx, input),
  getContactMessage: (input: { messageId: string }) =>
    getContactMessage(ctx, input),
  assignContactMessage: (input: {
    messageId: string;
    assigneeId: string | null;
  }) => assignContactMessage(ctx, input),
  changeContactMessageStatus: (input: {
    messageId: string;
    status: string;
    closeReason?: string;
  }) => changeContactMessageStatus(ctx, input),
  addContactNote: (input: { messageId: string; body: string }) =>
    addContactNote(ctx, input),
});
