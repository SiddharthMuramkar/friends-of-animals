import { connection } from "next/server";

// The directory listings a person looks after (#127) carry a per-request
// CSP nonce (src/proxy.ts, #65), like every signed-in tree: waiting for
// the request here leaves the whole document to request time, and
// `instant = false` lets this tree build with an empty static shell
// (src/app/account/layout.tsx explains why).
export const instant = false;

export default async function OrganisationLayout({
  children,
}: LayoutProps<"/organisation">) {
  await connection();
  return children;
}
