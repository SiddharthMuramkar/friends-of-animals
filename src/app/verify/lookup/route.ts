import { connection } from "next/server";
import { normaliseCertificateNumber } from "@/server/modules/certificates/domain/number";
export async function GET(request: Request) {
  await connection();
  const number = normaliseCertificateNumber(
    new URL(request.url).searchParams.get("number") ?? ""
  );
  return new Response(null, {
    status: 303,
    headers: {
      Location: `/verify/${number ?? "unknown"}`,
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}
