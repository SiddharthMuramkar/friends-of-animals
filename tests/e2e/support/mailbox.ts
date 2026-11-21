import { expect, type APIRequestContext } from "@playwright/test";

function mailboxToken(): string {
  const token = process.env.CAPTURE_MAILBOX_TOKEN;
  if (!token) {
    throw new Error(
      "Set CAPTURE_MAILBOX_TOKEN to the deployment's token to read sign-in codes."
    );
  }
  return token;
}

type CapturedEmail = { subject: string; text: string; sentAt: string };

/**
 * The newest messages to `email` (an email address, or a phone number
 * for texts) in the deployment's capture mailbox (GET
 * /api/capture-mailbox), newest first. The address goes in a header, so it
 * stays out of request logs.
 */
async function inbox(
  request: APIRequestContext,
  email: string
): Promise<CapturedEmail[]> {
  const response = await request.get("/api/capture-mailbox", {
    headers: {
      "x-capture-mailbox-token": mailboxToken(),
      "x-capture-mailbox-to": email,
    },
  });
  expect(response.status(), "capture mailbox status").toBe(200);
  const { messages } = (await response.json()) as {
    messages: CapturedEmail[];
  };
  return messages;
}

/**
 * The newest sign-in code sent to `email`, or undefined if none was sent.
 * Other mail (the welcome email, #61) may have arrived since, so this
 * reads the newest message that holds a code, not just the newest one.
 */
async function latestCode(
  request: APIRequestContext,
  email: string
): Promise<string | undefined> {
  for (const message of await inbox(request, email)) {
    const code = /\b(\d{6})\b/.exec(message.text)?.[1];
    if (code) return code;
  }
  return undefined;
}

/**
 * Waits briefly for a code to `email` other than `after` (one already
 * used), and returns it. The code is stored before the form moves on, so it
 * is normally there on the first try.
 */
export async function readCode(
  request: APIRequestContext,
  email: string,
  after?: string
): Promise<string> {
  let code: string | undefined;
  await expect
    .poll(
      async () => {
        code = await latestCode(request, email);
        return code !== undefined && code !== after;
      },
      { message: `a new sign-in code for ${email}`, timeout: 10_000 }
    )
    .toBe(true);
  return code!;
}

function uniqueId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** An address nobody has used: one per test, project and run. */
export function freshEmail(project: string): string {
  return `e2e+${project}-${uniqueId()}@example.test`;
}

/**
 * A fresh address of about 55 characters with no hyphen, so a browser has
 * nowhere to break it: for checking that long addresses wrap.
 */
export function freshLongEmail(project: string): string {
  return `e2e.longaddress.narrowscreen.${project}${uniqueId()}@example.test`;
}

/**
 * An Indian mobile number nobody has used, as "+91 9xxxx xxxxx": one per
 * test, so runs and projects don't share codes or the 5-per-phone limit.
 */
export function freshPhone(): string {
  const digits = `${Date.now() % 1e9}`.padStart(9, "0");
  const random = Math.floor(Math.random() * 1e4)
    .toString()
    .padStart(4, "0");
  const national = `9${(Number(digits) + Number(random)).toString().padStart(9, "0").slice(-9)}`;
  return `+91 ${national.slice(0, 5)} ${national.slice(5)}`;
}

/**
 * Delivers the deployment's due outbox events now (POST /api/preview/drain)
 * with the deployment's own code, rather than waiting for the shared VPS
 * worker. Staging and production answer 404: their own worker delivers.
 */
export async function drainOutbox(request: APIRequestContext): Promise<void> {
  const response = await request.post("/api/preview/drain", {
    headers: { "x-capture-mailbox-token": mailboxToken() },
  });
  expect([200, 404], "outbox drain status").toContain(response.status());
}

/**
 * Waits for the newest email to `email` with this subject and returns it.
 * After drainOutbox() on a preview it is there at once; where a worker
 * delivers (staging), it may take up to the worker's poll interval.
 */
export async function readEmail(
  request: APIRequestContext,
  email: string,
  subject: string
): Promise<CapturedEmail> {
  let found: CapturedEmail | undefined;
  await expect
    .poll(
      async () => {
        found = (await inbox(request, email)).find(
          (message) => message.subject === subject
        );
        return found !== undefined;
      },
      { message: `an email "${subject}" to ${email}`, timeout: 60_000 }
    )
    .toBe(true);
  return found!;
}
