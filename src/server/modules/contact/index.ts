// The contact inbox (#113): the public contact form and the staff inbox.

import type { UseCaseContext } from "../../use-cases";

export type SubmitContactMessageResult =
  | { ok: true; reference: string }
  | { ok: false; error: "invalid_input"; fields: string[] }
  | { ok: false; error: "human_check_failed" }
  | {
      ok: false;
      error: "rate_limited";
      retryAfter: Date;
      retryAfterSeconds: number;
    };

export const contactUseCases = (ctx: UseCaseContext) => ({
  submitContactMessage: async (
    input: unknown
  ): Promise<SubmitContactMessageResult> => {
    void ctx;
    void input;
    throw new Error("not built yet");
  },
});
