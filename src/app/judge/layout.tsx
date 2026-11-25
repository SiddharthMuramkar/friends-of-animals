import { connection } from "next/server";
// Signed-in and bearer invitation pages both carry a request CSP nonce.
export const instant = false;
export default async function Layout({ children }: LayoutProps<"/judge">) {
  await connection();
  return children;
}
