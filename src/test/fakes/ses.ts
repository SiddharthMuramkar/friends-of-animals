// Amazon SES v2 for tests, at the HTTP boundary: a request handler for the
// real SESv2Client (its `requestHandler`). It answers SendEmail
// (POST /v2/email/outbound-emails) the way SES does, keeps each accepted
// message in its recipient's mailbox, and records every request. The SDK
// still builds, signs and parses each request and reply, so a test sees
// what SES would get, and nothing leaves the process.

import {
  normaliseEmailAddress,
  type ReceivedEmail,
} from "@/server/ports/email";

import type { FakeClock } from "./clock";

/** One SendEmail call, as SES received it. */
export type SesRequest = {
  method: string;
  /** The regional endpoint, e.g. email.ap-south-1.amazonaws.com. */
  hostname: string;
  path: string;
  /** The SigV4 Authorization header: names the key id, never the secret. */
  authorization: string;
  /** The SendEmail request body (SES v2's JSON). */
  body: SendEmailBody;
};

type Text = { Data: string; Charset?: string };

/** The parts of a SendEmail request body that FOA sends. */
export type SendEmailBody = {
  FromEmailAddress?: string;
  Destination?: { ToAddresses?: string[] };
  Content?: {
    Simple?: { Subject?: Text; Body?: { Text?: Text; Html?: Text } };
  };
  ConfigurationSetName?: string;
};

/** How SES answers a request it won't take. */
export type SesRefusal = {
  /** The HTTP status, e.g. 400. */
  status: number;
  /** SES's error type, e.g. "MessageRejected". */
  type: string;
  message: string;
};

type HttpRequest = {
  method: string;
  hostname: string;
  path: string;
  headers: Record<string, string>;
  body?: unknown;
};

type Reply = {
  status: number;
  headers?: Record<string, string>;
  json: unknown;
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bodyText(body: unknown): string {
  if (typeof body === "string") return body;
  if (body instanceof Uint8Array) return decoder.decode(body);
  throw new Error("FakeSes: unexpected request body");
}

/** SES refuses an address with spaces around it: "Illegal address". */
function illegal(address: string): boolean {
  return address !== address.trim() || !address.includes("@");
}

export class FakeSes {
  readonly requests: SesRequest[] = [];
  readonly #clock: FakeClock;
  readonly #mailboxes = new Map<string, ReceivedEmail[]>();
  #refusal: SesRefusal | undefined;
  #networkError: Error | undefined;
  #nextMessageId = 1;

  constructor(clock: FakeClock) {
    this.#clock = clock;
  }

  /** SESv2Client's `requestHandler`. */
  readonly handler = {
    handle: async (request: HttpRequest) => {
      if (this.#networkError) throw this.#networkError;
      const reply = this.#answer(request);
      return {
        response: {
          statusCode: reply.status,
          headers: {
            "content-type": "application/json",
            "x-amzn-requestid": `fake-request-${this.requests.length}`,
            ...reply.headers,
          },
          body: encoder.encode(JSON.stringify(reply.json)),
        },
      };
    },
    updateHttpClientConfig: () => {},
    httpHandlerConfigs: () => ({}),
  };

  /** From now on SES answers every request with this error. */
  refuse(refusal: SesRefusal): void {
    this.#refusal = refusal;
  }

  /** From now on SES can't be reached: every request fails with `error`. */
  cutOff(error: Error): void {
    this.#networkError = error;
  }

  /** The recipient's messages, newest first, whatever the address's case. */
  inbox(to: string): ReceivedEmail[] {
    return [...(this.#mailboxes.get(normaliseEmailAddress(to)) ?? [])];
  }

  #answer(request: HttpRequest): Reply {
    const authorization = request.headers.authorization ?? "";
    const body = JSON.parse(bodyText(request.body)) as SendEmailBody;
    this.requests.push({
      method: request.method,
      hostname: request.hostname,
      path: request.path,
      authorization,
      body,
    });
    if (
      request.method !== "POST" ||
      request.path !== "/v2/email/outbound-emails"
    ) {
      return refusal({
        status: 404,
        type: "NotFoundException",
        message: "Not found",
      });
    }
    if (!authorization.startsWith("AWS4-HMAC-SHA256 Credential=")) {
      return refusal({
        status: 403,
        type: "UnrecognizedClientException",
        message: "The security token included in the request is invalid.",
      });
    }
    if (this.#refusal) return refusal(this.#refusal);

    const to = body.Destination?.ToAddresses ?? [];
    const simple = body.Content?.Simple;
    if (to.length === 0 || to.some(illegal)) {
      return refusal({
        status: 400,
        type: "BadRequestException",
        message: "Illegal address",
      });
    }
    if (!body.FromEmailAddress || !simple?.Subject || !simple.Body?.Text) {
      return refusal({
        status: 400,
        type: "BadRequestException",
        message: "Missing required field",
      });
    }
    for (const address of to) {
      const key = normaliseEmailAddress(address);
      const mailbox = this.#mailboxes.get(key) ?? [];
      mailbox.unshift({
        to: address,
        subject: simple.Subject.Data,
        text: simple.Body.Text.Data,
        ...(simple.Body.Html ? { html: simple.Body.Html.Data } : {}),
        sentAt: this.#clock.now(),
      });
      this.#mailboxes.set(key, mailbox);
    }
    const messageId = `fake-message-${this.#nextMessageId++}`;
    return { status: 200, json: { MessageId: messageId } };
  }
}

function refusal({ status, type, message }: SesRefusal): Reply {
  return {
    status,
    headers: { "x-amzn-errortype": type },
    json: { message },
  };
}
