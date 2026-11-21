import { connection } from "next/server";
import type { ReactNode } from "react";

// The admin pages are signed-in pages, so they carry a per-request CSP
// nonce (src/proxy.ts, #65), and Next puts it only on the scripts it
// renders for that request. As in src/app/account/layout.tsx, waiting for
// the request here, above every Suspense boundary, leaves the whole
// document to request time, and `instant = false` lets this tree build
// with an empty static shell. scripts/check-build.ts fails the build if a
// signed-in route gets a shell back.
export const instant = false;

export default async function AdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  await connection();
  return children;
}
