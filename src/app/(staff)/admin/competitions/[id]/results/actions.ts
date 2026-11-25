"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { APP_ROUTES, adminCompetitionResultsPath } from "@/lib/app-routes";
import { secondFactorPath } from "@/lib/second-factor-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import { DomainError } from "@/server/errors";
import { istLocalToInstant } from "@/server/modules/competitions/domain/ist";
const read = (form: FormData, name: string) => {
  const v = form.get(name);
  return typeof v === "string" ? v : "";
};
export async function resultsAction(form: FormData) {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const competitionId = read(form, "competitionId");
  if (!z.uuid().safeParse(competitionId).success)
    redirect(APP_ROUTES.adminCompetitions);
  const target = adminCompetitionResultsPath(competitionId);
  const api = as(actor);
  const operation = read(form, "operation");
  let done = "invalid_input";
  try {
    if (operation === "prepare") {
      const instant = istLocalToInstant(read(form, "publishAt"));
      if (instant.ok) {
        const r = await api.prepareResultsRelease({
          competitionId,
          sourceRoundId: read(form, "sourceRoundId"),
          publishAt: instant.at.toISOString(),
          deliveryNote: read(form, "deliveryNote"),
        });
        done = r.ok ? "prepared" : r.error;
      } else done = "invalid_date";
    } else if (operation === "approve" || operation === "reject") {
      const input = { competitionId, releaseId: read(form, "releaseId") };
      const r = await (operation === "approve"
        ? api.approveResultsRelease(input)
        : api.rejectResultsRelease(input));
      done = r.ok ? r.status : r.error;
    }
  } catch (error) {
    if (error instanceof DomainError) {
      const path = secondFactorPath(error.code, target);
      if (path) redirect(path);
      if (error.code === "forbidden") done = "forbidden";
      else throw error;
    } else throw error;
  }
  redirect(`${target}?${new URLSearchParams({ done })}`);
}
