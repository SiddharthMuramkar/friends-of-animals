import { connection } from "next/server";
export const instant = false;
export default async function Layout({ children }: LayoutProps<"/clubs">) {
  await connection();
  return children;
}
