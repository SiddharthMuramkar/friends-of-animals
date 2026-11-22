import { connection } from "next/server";

// Signed-in pages carry a per-request CSP nonce (src/proxy.ts, #65), which
// a static shell's build-time scripts can't have. Waiting for the request
// here, above every Suspense boundary, leaves the whole page to request
// time; `instant = false` lets it build with an empty static shell.
export const instant = false;

export default async function ParticipantLayout({
  children,
}: LayoutProps<"/participant">) {
  await connection();
  return children;
}
