import { describe, expect, it } from "vitest";

import { createHarness } from "@/test/harness";

import type { Actor } from "./actor";
import { composeUseCases, type UseCaseContext } from "./use-cases";

const visitor: Actor = {
  kind: "visitor",
  meta: { ip: "203.0.113.7", userAgent: "test" },
};

const greetings = (ctx: UseCaseContext) => ({
  whoAmI: async () => ctx.actor,
  whatTimeIsIt: async () => ctx.clock.now(),
});

const mail = (ctx: UseCaseContext) => ({
  sendHello: async (input: { to: string }) =>
    ctx.email.send({ to: input.to, subject: "Hello", text: "Hello" }),
});

describe("composeUseCases", () => {
  it("gives every use case the acting user and the deps", async () => {
    const { deps } = await createHarness();
    const useCases = composeUseCases(greetings)({ ...deps, actor: visitor });

    expect(await useCases.whoAmI()).toBe(visitor);
    expect(await useCases.whatTimeIsIt()).toEqual(deps.clock.now());
  });

  it("merges every module's use cases into one flat set", async () => {
    const { deps, email } = await createHarness();
    const useCases = composeUseCases(
      greetings,
      mail
    )({ ...deps, actor: visitor });

    await useCases.sendHello({ to: "asha@example.test" });

    expect(Object.keys(useCases).sort()).toEqual([
      "sendHello",
      "whatTimeIsIt",
      "whoAmI",
    ]);
    expect(email.lastTo("asha@example.test")?.subject).toBe("Hello");
  });

  it("refuses two modules that name the same use case", async () => {
    const { deps } = await createHarness();
    const rival = (_ctx: UseCaseContext) => ({ whoAmI: async () => null });

    // @ts-expect-error: a duplicate use-case name fails type-checking too.
    const compose = composeUseCases(greetings, rival);

    expect(() => compose({ ...deps, actor: visitor })).toThrow(
      /whoAmI.*more than one module/
    );
  });
});
