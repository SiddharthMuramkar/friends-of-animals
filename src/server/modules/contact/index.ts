// The contact inbox (#113): the public contact form, routed by topic to a
// staff team. Its use cases join `as(actor)` through `contactUseCases`.

import type { UseCaseContext } from "../../use-cases";
import { submitContactMessage, type SubmitContactMessageInput } from "./submit";

export type {
  SubmitContactMessageInput,
  SubmitContactMessageResult,
} from "./submit";

export const contactUseCases = (ctx: UseCaseContext) => ({
  submitContactMessage: (input: SubmitContactMessageInput) =>
    submitContactMessage(ctx, input),
});
