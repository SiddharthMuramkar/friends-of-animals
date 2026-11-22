import { inspect } from "node:util";
import { describe, expect, it } from "vitest";

import type { E164Phone } from "@/lib/phone";

import { SmsNotConfiguredError, unconfiguredSmsSender } from "./sms";
import { MSG91_FLOW_URL, msg91SmsSender } from "./sms-msg91";

const AUTH_KEY = "msg91-auth-key-for-tests-0123456789";
const message = {
  to: "+919876543210" as E164Phone,
  template: "sign-in-code" as const,
  vars: { code: "482913", minutes: "10" },
  text: "Your sign-in code is 482913.",
};

type Call = { url: string; init: RequestInit };

/** A fetch that records each request and answers with `reply`. */
function fakeFetch(reply: () => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetch = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: url instanceof Request ? url.url : url.toString(),
      init: init ?? {},
    });
    return reply();
  };
  return { fetch: fetch as typeof globalThis.fetch, calls };
}

function sender(fetch: typeof globalThis.fetch) {
  return msg91SmsSender(
    { authKey: AUTH_KEY, templates: { "sign-in-code": "otp-template-id" } },
    fetch
  );
}

async function failure(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => null,
    (error: unknown) => error
  );
}

function leaks(error: unknown): string[] {
  const everything = inspect(error, { depth: 10, showHidden: true });
  return ["9876543210", "482913", AUTH_KEY].filter((secret) =>
    everything.includes(secret)
  );
}

describe("msg91SmsSender", () => {
  it("sends through MSG91's flow API with the template and its variables", async () => {
    const { fetch, calls } = fakeFetch(() =>
      Response.json({ type: "success", message: "5e1e93cad6fc054d8e759a5b" })
    );

    await sender(fetch).send(message);

    expect(MSG91_FLOW_URL).toBe("https://control.msg91.com/api/v5/flow");
    expect(calls).toHaveLength(1);
    const [{ url, init }] = calls as [Call];
    expect(url).toBe(MSG91_FLOW_URL);
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("authkey")).toBe(AUTH_KEY);
    expect(new Headers(init.headers).get("content-type")).toBe(
      "application/json"
    );
    expect(typeof init.body).toBe("string");
    expect(JSON.parse(init.body as string)).toEqual({
      template_id: "otp-template-id",
      short_url: "0",
      recipients: [{ mobiles: "919876543210", code: "482913", minutes: "10" }],
    });
  });

  it("refuses a template it has no DLT template id for, without calling MSG91", async () => {
    const { fetch, calls } = fakeFetch(() =>
      Response.json({ type: "success" })
    );

    const error = await failure(
      sender(fetch).send({
        to: "+919876543210" as E164Phone,
        template: "coordinator-invitation",
        vars: { institution: "Green Valley School", link: "https://x/y" },
        text: "Green Valley School invites you.",
      })
    );

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("coordinator-invitation");
    expect(calls).toHaveLength(0);
    expect(leaks(error)).toEqual([]);
  });

  it("rejects when MSG91 answers with an error, keeping its reason but no number, code or key", async () => {
    const { fetch } = fakeFetch(() =>
      Response.json({
        type: "error",
        message: "Mobile 919876543210 is in DND for template",
      })
    );

    const error = await failure(sender(fetch).send(message));

    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toMatch(/MSG91 refused[\s\S]*DND for template/);
    expect(leaks(error)).toEqual([]);
  });

  it("rejects on an HTTP error status", async () => {
    const { fetch } = fakeFetch(
      () => new Response("Unauthorized", { status: 401 })
    );

    const error = await failure(sender(fetch).send(message));

    expect(String(error)).toMatch(/401/);
    expect(leaks(error)).toEqual([]);
  });

  it("rejects when MSG91 can't be reached, without the request in the error", async () => {
    const { fetch } = fakeFetch(() => {
      throw new TypeError("fetch failed", {
        cause: new Error(`authkey ${AUTH_KEY} body 919876543210 482913`),
      });
    });

    const error = await failure(sender(fetch).send(message));

    expect(String(error)).toMatch(/could not reach MSG91/);
    expect(leaks(error)).toEqual([]);
  });
});

describe("unconfiguredSmsSender", () => {
  it("refuses every message", async () => {
    await expect(unconfiguredSmsSender.send(message)).rejects.toBeInstanceOf(
      SmsNotConfiguredError
    );
  });
});
