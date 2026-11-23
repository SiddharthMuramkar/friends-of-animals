import { inspect } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FakeClock } from "@/test/fakes/clock";
import { FakeSes, type SesRequest } from "@/test/fakes/ses";

import { emailSenderContract } from "./email.contract";
import { sesEmailSender, type SesConfig } from "./email-ses";

const SES: SesConfig = {
  region: "ap-south-1",
  accessKeyId: "AKIAIOSFODNN7EXAMPLE",
  secretAccessKey: "test-ses-secret-access-key",
  from: "Friends of Animals <no-reply@friendsofanimals.dev>",
};

emailSenderContract("sesEmailSender", async () => {
  const clock = new FakeClock();
  const ses = new FakeSes(clock);
  return {
    sender: sesEmailSender(SES, ses.handler),
    inbox: async (to) => ses.inbox(to),
    clock,
  };
});

function setup(config: SesConfig = SES) {
  const clock = new FakeClock();
  const ses = new FakeSes(clock);
  return { ses, sender: sesEmailSender(config, ses.handler) };
}

const message = {
  to: "asha@example.test",
  subject: "Your sign-in code",
  text: "Your sign-in code is 482913. It works for 10 minutes…",
};

describe("sesEmailSender", () => {
  it("sends with SendEmail to SES in its region, signed with the key id and never the secret", async () => {
    const { ses, sender } = setup();

    await sender.send(message);

    expect(ses.requests).toHaveLength(1);
    const [request] = ses.requests as [SesRequest];
    expect(request.method).toBe("POST");
    expect(request.hostname).toBe("email.ap-south-1.amazonaws.com");
    expect(request.path).toBe("/v2/email/outbound-emails");
    expect(request.authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE\/\d{8}\/ap-south-1\/ses\/aws4_request,/
    );
    expect(JSON.stringify(request)).not.toContain(SES.secretAccessKey);
  });

  it("sends from SES_FROM, with every part in UTF-8 and no configuration set unless one is given", async () => {
    const { ses, sender } = setup();

    await sender.send({
      ...message,
      html: "<p>Your code is <b>482913</b></p>",
    });

    expect(ses.requests[0]?.body).toEqual({
      FromEmailAddress: "Friends of Animals <no-reply@friendsofanimals.dev>",
      Destination: { ToAddresses: ["asha@example.test"] },
      Content: {
        Simple: {
          Subject: { Data: "Your sign-in code", Charset: "UTF-8" },
          Body: {
            Text: { Data: message.text, Charset: "UTF-8" },
            Html: {
              Data: "<p>Your code is <b>482913</b></p>",
              Charset: "UTF-8",
            },
          },
        },
      },
    });
  });

  it("sends through the configuration set when one is given", async () => {
    const { ses, sender } = setup({ ...SES, configurationSet: "foa-prod" });

    await sender.send(message);

    expect(ses.requests[0]?.body.ConfigurationSetName).toBe("foa-prod");
  });
});

async function failure(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => null,
    (error: unknown) => error
  );
}

/** What of the message or the keys an error would hand to a log. */
function leaks(error: unknown): string[] {
  const everything = inspect(error, { depth: 10, showHidden: true });
  return [
    "asha@example.test",
    "ravi@example.test",
    "482913",
    SES.accessKeyId,
    SES.secretAccessKey,
  ].filter((secret) => everything.includes(secret));
}

describe("sesEmailSender's failures", () => {
  it("rejects when SES refuses the message, keeping its reason but no address, code or key", async () => {
    const { ses, sender } = setup();
    // What SES says to an account still in the sandbox.
    ses.refuse({
      status: 400,
      type: "MessageRejected",
      message:
        "Email address is not verified. The following identities failed " +
        "the check in region AP-SOUTH-1: asha@example.test, ravi@example.test",
    });

    const error = await failure(sender.send(message));

    expect(error).toBeInstanceOf(Error);
    // SES's request id is what AWS support asks for.
    expect(String(error)).toMatch(
      /MessageRejected \(HTTP 400, request fake-request-1\)/
    );
    expect(String(error)).toMatch(
      /failed the check in region AP-SOUTH-1: \[address\], \[address\]/
    );
    expect(leaks(error)).toEqual([]);
  });

  it("rejects when SES can't be reached, without the request in the error", async () => {
    const { ses, sender } = setup();
    ses.cutOff(
      Object.assign(new Error("connect ECONNREFUSED 13.235.1.1:443"), {
        code: "ECONNREFUSED",
        request: { body: `asha@example.test 482913 ${SES.secretAccessKey}` },
      })
    );

    const error = await failure(sender.send(message));

    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toMatch(/could not reach SES/);
    expect(leaks(error)).toEqual([]);
  });
});

describe("sesEmailSender's subjects", () => {
  it.each([
    ["a line feed", "Your code\nBcc: ravi@example.test"],
    ["a carriage return", "Your code\r\nBcc: ravi@example.test"],
    ["a tab", "Your\tcode"],
    ["a NUL", "Your code\u0000"],
    ["a line separator", "Your code\u2028Bcc: ravi@example.test"],
  ])("refuses a subject with %s and never calls SES", async (_, subject) => {
    const { ses, sender } = setup();

    const error = await failure(sender.send({ ...message, subject }));

    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toMatch(
      /the subject has a line break or control character/
    );
    expect(ses.requests).toEqual([]);
    expect(leaks(error)).toEqual([]);
  });

  it("sends a subject in any script, with its punctuation", async () => {
    const { ses, sender } = setup();
    const subject = "आशा, your ₹500 receipt — thank you…";

    await sender.send({ ...message, subject });

    expect(ses.inbox(message.to)[0]?.subject).toBe(subject);
  });
});

describe("sesEmailSender's logs", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes no address, body or code to the console, sent or refused", async () => {
    const lines: unknown[][] = [];
    for (const level of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, level).mockImplementation((...args) => {
        lines.push(args);
      });
    }
    const { ses, sender } = setup();

    await sender.send({ ...message, html: "<p>482913</p>" });
    ses.refuse({ status: 400, type: "MessageRejected", message: "Rejected" });
    await failure(sender.send(message));

    const logged = inspect(lines, { depth: 10 });
    // SES's message id, to follow a bounce or a complaint, and nothing else.
    expect(logged).toContain("fake-message-1");
    expect(logged).not.toContain("asha@example.test");
    expect(logged).not.toContain("482913");
  });
});
