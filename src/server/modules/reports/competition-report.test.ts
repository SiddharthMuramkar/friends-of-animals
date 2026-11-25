import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createHarness } from "@/test/harness";
import { registration, certificate } from "../../db/schema";
import { insertCertificate } from "../certificates/issue";
import { signedInWith, managerOf } from "../judging/testing";
import { schoolEntriesAtFoa, signedInVerifier } from "../verification/testing";
import { parseCsv } from "../registration/domain/csv";

describe("competition reports", () => {
  it("counts the independent facts, zero-fills both routes and respects competition scope", async () => {
    const h = await createHarness();
    const school = await schoolEntriesAtFoa(h);
    const other = await h.seed.competition({code: "OTHR27"});
    const verifier = h.as(await signedInVerifier(h));
    expect(await verifier.verifyEntry({entryId: school.entryIds[1]!})).toMatchObject({ok:true});
    const regs = await h.db.select().from(registration).where(eq(registration.competitionId, school.competition.id));
    const [a, b] = regs;
    for (const [r, revoked] of [[a!, false], [b!, true]] as const) {
      const issued = await insertCertificate(h.db,h.clock,{
        type:"participation", competitionId:r.competitionId, registrationId:r.id,
        participantProfileId:r.participantProfileId, nameSnapshot:"Do not export this private name",
      });
      if (revoked) await h.db.update(certificate).set({status:"revoked",revokedAt:h.clock.now(),revokedReason:"Revoked fixture"}).where(eq(certificate.id,issued.id));
    }
    const manager = h.as(await signedInWith(h, managerOf(school.competition.id)));
    const input = {competitionCode: school.competition.code};
    const report = await manager.getCompetitionReport(input);
    if (!report.ok) throw Error(report.error);
    expect(report.report.rows).toEqual([
      expect.objectContaining({route:"institution", ageGroupLabel:"6–9", registrations:0, entries:0, shortlisted:0, verified:0, certificates:0}),
      expect.objectContaining({route:"institution", ageGroupLabel:"10–13", registrations:3, entries:3, shortlisted:2, verified:1, certificates:1}),
      expect.objectContaining({route:"individual", ageGroupLabel:"6–9", registrations:0, entries:0, shortlisted:null, verified:0, certificates:0}),
      expect.objectContaining({route:"individual", ageGroupLabel:"10–13", registrations:0, entries:0, shortlisted:null, verified:0, certificates:0}),
    ]);
    expect(report.report.total).toEqual({registrations:3,entries:3,shortlisted:2,verified:1,certificates:1});
    expect(await manager.listReportCompetitions()).toEqual([expect.objectContaining({id:school.competition.id})]);
    await expect(manager.getCompetitionReport({competitionCode:other.code})).rejects.toMatchObject({code:"forbidden"});
    await expect(manager.exportCompetitionReportCsv({competitionCode:other.code})).rejects.toMatchObject({code:"forbidden"});
    const csv = await manager.exportCompetitionReportCsv(input);
    if (!csv.ok) throw Error(csv.error);
    expect(csv.csv.startsWith("\uFEFF")).toBe(true);
    expect(csv.csv).not.toContain("Do not export this private name");
    expect(csv.csv).not.toContain(regs[0]!.registrationNumber!);
    expect(parseCsv(csv.csv)).toMatchObject({ok:true,records:expect.arrayContaining([["institution","10–13","3","3","2","1","1"]])});
    const member = h.as(await h.signIn(await h.seed.member()));
    await expect(member.getCompetitionReport(input)).rejects.toMatchObject({code:"forbidden"});
    await expect(member.exportCompetitionReportCsv(input)).rejects.toMatchObject({code:"forbidden"});
    await expect(member.listReportCompetitions()).rejects.toMatchObject({code:"forbidden"});
  });
});

it("counts fee captures per batch, completed refunds once, and real issued certificate rows",async()=>{
  const h=await createHarness();
  await h.seed.preview();
  const manager=h.as(await signedInWith(h,{role:"finance",scope:{type:"global"}}));
  const skies=await manager.getCompetitionReport({competitionCode:"SKIES26"});
  if(!skies.ok)throw Error(skies.error);
  expect(skies.report.fees).toEqual({
    currency:"INR",
    routes:[
      {route:"institution",totals:{capturedMinor:600_000n,refundedMinor:100_000n,netMinor:500_000n}},
      {route:"individual",totals:{capturedMinor:0n,refundedMinor:0n,netMinor:0n}},
    ],
    total:{capturedMinor:600_000n,refundedMinor:100_000n,netMinor:500_000n}
  });
  expect(skies.report.total).toMatchObject({registrations:5,entries:3,shortlisted:2,verified:0,certificates:0});
  const auction=await manager.getCompetitionReport({competitionCode:"AUCT27"});
  if(!auction.ok)throw Error(auction.error);
  expect(auction.report.total).toEqual({registrations:4,entries:4,shortlisted:0,verified:4,certificates:8});
  expect(auction.report.routeTotals).toEqual([
    {route:"institution",totals:{registrations:0,entries:0,shortlisted:0,verified:0,certificates:0}},
    {route:"individual",totals:{registrations:4,entries:4,shortlisted:null,verified:4,certificates:8}},
  ]);
  const csv=await manager.exportCompetitionReportCsv({competitionCode:"SKIES26"});
  if(!csv.ok)throw Error(csv.error);
  expect(parseCsv(csv.csv)).toMatchObject({ok:true,records:expect.arrayContaining([["institution","6000.00","1000.00","5000.00"]])});
});
