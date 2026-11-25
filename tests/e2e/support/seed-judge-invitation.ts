import { randomUUID } from "node:crypto";
import { expect } from "@playwright/test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { fieldKeyEnvSchema, parseEnv } from "../../../src/env.schema";
import { fieldCryptoFor } from "../../../src/server/crypto/keys";
import { directTls } from "../../../src/server/db/database-url";
import * as schema from "../../../src/server/db/schema";
import {
  DEVELOPMENT_AUTH_SECRET,
  CODE_REQUEST_LIMITS,
} from "../../../src/server/identity/settings";
import { CONTACT_RATE_LIMITS } from "../../../src/server/modules/contact/domain/submission";
import {
  acceptJudgeInvitation,
  acceptJudgeTerms,
  declareConflicts,
  inviteJudge,
} from "../../../src/server/modules/judging/judges";
import {
  createJudgingRound,
  openJudgingRound,
} from "../../../src/server/modules/judging/rounds";
import { latestDocument } from "../../../src/server/modules/consent/repository";
import { proofOfWorkHumanCheck } from "../../../src/server/modules/public-forms/proof-of-work-check";
import { generateTotpSecret } from "../../../src/server/modules/second-factor/domain/totp";
import { stampSession } from "../../../src/server/modules/second-factor/session-factor";
import { databaseSettings } from "../../../src/server/modules/settings/read";
import type { UseCaseContext } from "../../../src/server/use-cases";
import { FakeClock } from "../../../src/test/fakes/clock";
import { FakeCookieJar } from "../../../src/test/fakes/cookies";
import { FakeEmail } from "../../../src/test/fakes/email";
import { FakeErrorReporter } from "../../../src/test/fakes/errors";
import { FakeMalwareScanner } from "../../../src/test/fakes/malware-scanner";
import { FakeMediaProcessor } from "../../../src/test/fakes/media";
import { FakePaymentGateway } from "../../../src/test/fakes/payment-gateway";
import { FakePdfRenderer } from "../../../src/test/fakes/pdf";
import { FakeSms } from "../../../src/test/fakes/sms";
import { FakeStorage } from "../../../src/test/fakes/storage";
import { localSeedUrl, test as base } from "./seed-account";

type JudgingSetup = {
  invite(input: {
    competitionId: string;
    name: string;
    email: string;
  }): Promise<void>;
  onboard(email: string, token: string): Promise<void>;
};

/**
 * A test-local seam for the other actor's prior actions: real judging use
 * cases on the guarded local database, with the server's field keys and the
 * usual provider fakes. An invitation still emits its outbox event and is
 * delivered by the app's capture adapter, not fabricated by this fixture.
 */
export const test = base.extend<{ judgingSetup: JudgingSetup }>({
  judgingSetup: async ({ baseURL, seedAccount }, use) => {
    const url = localSeedUrl(baseURL);
    const fieldCrypto = fieldCryptoFor(
      parseEnv(fieldKeyEnvSchema, process.env)
    );
    const client = postgres(url, {
      ...directTls(url),
      max: 1,
      prepare: false,
      connect_timeout: 5,
    });
    const db = drizzle({ client, schema });
    const secret = process.env.BETTER_AUTH_SECRET || DEVELOPMENT_AUTH_SECRET;
    // Like createPgWorld.signedIn, create a real session for fixture actors;
    // the user-facing sign-in and second-factor journey is tested separately.
    async function context(
      email: string,
      staff = false
    ): Promise<UseCaseContext> {
      const [account] = await db
        .select({ id: schema.user.id })
        .from(schema.user)
        .where(eq(schema.user.email, email));
      if (!account) throw new Error("No seeded judging account.");
      const clock = new FakeClock(new Date());
      const now = clock.now();
      const sessionId = randomUUID();
      await db.insert(schema.session).values({
        id: sessionId,
        userId: account.id,
        token: randomUUID(),
        expiresAt: new Date(now.getTime() + 60 * 60 * 1_000),
        createdAt: now,
        updatedAt: now,
      });
      if (staff) await stampSession(db, sessionId, now, "totp");
      return {
        actor: {
          kind: "user",
          userId: account.id,
          sessionId,
          meta: { ip: "203.0.113.20", userAgent: "Playwright judging fixture" },
        },
        appEnv: "local",
        db,
        clock,
        ...fieldCrypto,
        auth: { secret, baseUrl: baseURL! },
        email: new FakeEmail(clock),
        sms: new FakeSms(clock),
        cookies: new FakeCookieJar(clock),
        settings: databaseSettings(db),
        storage: new FakeStorage(clock),
        files: {
          bucket: "foa-files-test",
          keyPrefix: "local/",
          appEnv: "local",
          publicBaseUrl: null,
        },
        errors: new FakeErrorReporter(),
        scanner: new FakeMalwareScanner(),
        media: new FakeMediaProcessor(),
        pdf: new FakePdfRenderer(),
        humanCheck: proofOfWorkHumanCheck({ secret, difficulty: 4 }),
        contactLimits: CONTACT_RATE_LIMITS,
        codeRequestLimits: CODE_REQUEST_LIMITS,
        payments: new FakePaymentGateway(randomUUID(), clock),
      };
    }
    try {
      await use({
        async invite({ competitionId, name, email }) {
          const manager = await seedAccount({
            name: "Invitation fixture manager",
            grants: [
              {
                role: "competition_manager",
                scope: { type: "competition", id: competitionId },
              },
            ],
            totpSecret: generateTotpSecret(),
          });
          const ctx = await context(manager, true);
          const created = await createJudgingRound(ctx, {
            competitionId,
            name,
          });
          if (!created.ok)
            throw new Error(`Could not create fixture round: ${created.error}`);
          const { roundId } = created;
          expect(await openJudgingRound(ctx, { roundId })).toMatchObject({
            ok: true,
          });
          expect(await inviteJudge(ctx, { roundId, email })).toMatchObject({
            ok: true,
          });
        },
        async onboard(email, token) {
          const ctx = await context(email);
          const accepted = await acceptJudgeInvitation(ctx, { token });
          if (!accepted.ok)
            throw new Error(
              `Could not accept fixture invitation: ${accepted.error}`
            );
          const { roundId } = accepted;
          const conduct = await latestDocument(db, "judge_conduct");
          const confidentiality = await latestDocument(
            db,
            "judge_confidentiality"
          );
          if (!conduct || !confidentiality)
            throw new Error("Seed judge terms are missing.");
          expect(
            await acceptJudgeTerms(ctx, {
              roundId,
              conductDocumentId: conduct.id,
              confidentialityDocumentId: confidentiality.id,
            })
          ).toMatchObject({ ok: true });
          expect(
            await declareConflicts(ctx, {
              roundId,
              declaration: { none: true },
            })
          ).toMatchObject({ ok: true });
        },
      });
    } finally {
      await client.end({ timeout: 5 });
    }
  },
});
