// The notifications module (#69): message templates staff edit, the
// routes from domain events to messages, the dispatcher the outbox runs
// for them, each user's in-app inbox and their channel choices. Its use
// cases join `as(actor)` through `notificationsUseCases`. Producers never
// call it: they emit an outbox event, and a route row decides the rest.

import type { UseCaseContext } from "../use-cases";
import {
  getMessageTemplate,
  listMessageTemplates,
  updateMessageTemplate,
  type UpdateMessageTemplateInput,
} from "./templates";

export type {
  GetMessageTemplateResult,
  MessageTemplateDetail,
  TemplateListItem,
  TemplateSummary,
  TemplateView,
  UpdateMessageTemplateInput,
  UpdateMessageTemplateResult,
} from "./templates";
export type { MessageChannel } from "./domain/channels";
export type { RevisionProblem } from "./domain/revision";

export const notificationsUseCases = (ctx: UseCaseContext) => ({
  listMessageTemplates: () => listMessageTemplates(ctx),
  getMessageTemplate: (input: { key: string }) =>
    getMessageTemplate(ctx, input),
  updateMessageTemplate: (input: UpdateMessageTemplateInput) =>
    updateMessageTemplate(ctx, input),
});
