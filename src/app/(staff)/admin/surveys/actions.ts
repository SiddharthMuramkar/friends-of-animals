"use server";
import { redirect } from "next/navigation";
import { as, currentActor } from "@/server/app";
import { DomainError } from "@/server/errors";
import { adminSurveyPath } from "@/lib/app-routes";
export async function saveSurveyAction(competitionId: string, data: FormData) {
  const questions = [];
  for (let i = 0; i < 10; i++) {
    const text = String(data.get(`text${i}`) ?? "").trim(),
      choices = String(data.get(`choices${i}`) ?? "")
        .split(/\r?\n/)
        .map((x) => x.trim())
        .filter(Boolean);
    if (text || choices.length) questions.push({ text, choices });
  }
  let result: string;
  try {
    const saved = await as(await currentActor()).saveSurvey({
      competitionId,
      title: data.get("title"),
      questions,
    });
    result = saved.ok ? "saved" : saved.error;
  } catch (e) {
    if (!(e instanceof DomainError)) throw e;
    result = "forbidden";
  }
  redirect(`${adminSurveyPath(competitionId)}&result=${result}`);
}
export async function sendSurveyAction(competitionId: string) {
  let result: string;
  try {
    const sent = await as(await currentActor()).sendSurvey({ competitionId });
    result = sent.ok ? "sent" : sent.error;
  } catch (e) {
    if (!(e instanceof DomainError)) throw e;
    result = "forbidden";
  }
  redirect(`${adminSurveyPath(competitionId)}&result=${result}`);
}
export async function closeSurveyAction(competitionId: string) {
  let result: string;
  try {
    const closed = await as(await currentActor()).closeSurvey({
      competitionId,
    });
    result = closed.ok ? "closed" : closed.error;
  } catch (e) {
    if (!(e instanceof DomainError)) throw e;
    result = "forbidden";
  }
  redirect(`${adminSurveyPath(competitionId)}&result=${result}`);
}
