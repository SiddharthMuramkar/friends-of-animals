// Local, disposable real-media proof for #102. The CI E2E app intentionally
// has no Gotenberg/worker-media; this process drains the actual media queue
// on the test host, using the isolated local storage root and Poppler
// installed there. Never run against a deployment.
import { setTimeout as delay } from "node:timers/promises";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../../../src/server/db/schema";
import { directTls } from "../../../src/server/db/database-url";
import { fieldCryptoFor } from "../../../src/server/crypto/keys";
import { databaseSettings } from "../../../src/server/modules/settings/read";
import { drainUntilIdle, type OutboxDeps } from "../../../src/server/outbox";
import { systemClock } from "../../../src/server/ports/clock";
import { unconfiguredEmailSender } from "../../../src/server/ports/email";
import { unconfiguredSmsSender } from "../../../src/server/ports/sms";
import { unconfiguredScanner } from "../../../src/server/ports/malware-scanner";
import { fallbackPaymentGateway } from "../../../src/server/ports/payment-gateway-fallback";
import { sharpMediaProcessor } from "../../../src/server/ports/media-sharp";
import { ffmpegVideoProcessor } from "../../../src/server/ports/media-ffmpeg";
import { popplerPdfProcessor } from "../../../src/server/ports/media-pdf";
import { stampProcessor } from "../../../src/server/ports/media-stamp";
import { gotenbergPdfRenderer } from "../../../src/server/ports/pdf-gotenberg";
import { storageFor } from "../../../src/server/ports/storage-for";
import { seedFilesLocation } from "../../../src/server/seed/files";

const url = new URL(process.env.DIRECT_URL ?? "");
const baseUrl = process.env.APP_URL;
const renderer = process.env.GOTENBERG_URL;
if (
  process.env.APP_ENV !== "local" ||
  url.hostname !== "127.0.0.1" ||
  url.port !== "5455" ||
  url.pathname !== "/foa_t102" ||
  !baseUrl ||
  !renderer
)
  throw new Error("Use the isolated local foa_t102 E2E database and renderer");

const sql = postgres(url.href, {
  ...directTls(url.href),
  max: 2,
  prepare: false,
});
const db = drizzle({ client: sql, schema });
const deps: OutboxDeps = {
  appEnv: "local",
  db,
  clock: systemClock,
  ...fieldCryptoFor({
    APP_ENV: "local",
    FIELD_ENCRYPTION_KEYS: process.env.FIELD_ENCRYPTION_KEYS,
    FIELD_HMAC_KEY: process.env.FIELD_HMAC_KEY,
  }),
  settings: databaseSettings(db),
  auth: { baseUrl },
  email: unconfiguredEmailSender,
  sms: unconfiguredSmsSender,
  scanner: unconfiguredScanner,
  payments: fallbackPaymentGateway({ db, clock: systemClock, appEnv: "local" }),
  storage: storageFor({ APP_ENV: "local", APP_URL: baseUrl }),
  files: seedFilesLocation(),
  media: {
    ...sharpMediaProcessor(),
    ...ffmpegVideoProcessor(),
    ...popplerPdfProcessor(),
    ...stampProcessor(),
  },
  pdf: gotenbergPdfRenderer({ baseUrl: renderer }),
};
let stopping = false;
process.on("SIGTERM", () => {
  stopping = true;
});
process.on("SIGINT", () => {
  stopping = true;
});
try {
  while (!stopping) {
    await drainUntilIdle(deps, { queue: "media" });
    await delay(200);
  }
} finally {
  await sql.end();
}
