export async function GET(): Promise<Response> {
  return Response.json({ status: "missing" }, { status: 200 });
}
