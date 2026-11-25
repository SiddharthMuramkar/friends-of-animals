import type { UseCaseContext } from "../../use-cases";

import { getTransparency } from "./read";

export const transparencyUseCases = (ctx: UseCaseContext) => ({
  getTransparency: (input?: { fy?: string }) => getTransparency(ctx, input),
  getFundsRaised: async () => {
    const model = await getTransparency(ctx);
    return model.published
      ? {
          fy: model.fy,
          amountMinor: model.donationsMinor,
          publishedThrough: model.months.at(-1)!.month,
        }
      : null;
  },
});
