import { describe, expect, it } from "vitest";
import { createHarness } from "@/test/harness";
import { seedInstitution } from "@/test/institutions";
import { signedInWith } from "../judging/testing";

describe("admin home", () => {
  it("counts only the waiting institutions and lists them in waiting order, with no inaccessible queues", async () => {
    const h = await createHarness();
    const first = await seedInstitution(h, { status: "pending_verification", name: "First School" });
    h.clock.advance({ days: 1 });
    const second = await seedInstitution(h, { status: "pending_verification", name: "Second School" });
    await seedInstitution(h, { status: "verified" });
    const staff = h.as(await signedInWith(h, { role: "staff_admin", scope: { type: "global" } }));
    const home = await staff.getAdminHome();
    expect(home.queues).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "institutions_to_verify", count: 2 }),
    ]));
    expect(home.queues.map(q => q.key)).toEqual(["institutions_to_verify", "artwork_arriving", "results_to_approve"]);
    const page = await staff.listQueueItems({ key: "institutions_to_verify", limit: 1 });
    if (!page.ok) throw Error(page.error);
    expect(page.items.map(i => i.id)).toEqual([first.institution.id]);
    const next = await staff.listQueueItems({ key: "institutions_to_verify", cursor: page.nextCursor! });
    if (!next.ok) throw Error(next.error);
    expect(next.items.map(i => i.id)).toEqual([second.institution.id]);
    const verifier = h.as(await signedInWith(h, { role: "foa_verifier", scope: { type: "global" } }));
    expect((await verifier.getAdminHome()).queues.map(q => q.key)).toEqual(["entries_to_verify", "artwork_arriving"]);
    await expect(verifier.listQueueItems({ key: "institutions_to_verify" })).rejects.toMatchObject({ code: "forbidden" });
    await expect(h.as(h.visitor()).getAdminHome()).rejects.toMatchObject({ code: "forbidden" });
  });
});

it("matches the actual preview work queues, and separates safeguarding and scoped competition work", async () => {
  const h=await createHarness();
  await h.seed.preview();
  const verifier=h.as(await signedInWith(h,{role:"foa_verifier",scope:{type:"global"}}));
  const ver=await verifier.listVerificationQueue({});
  if(!ver.ok) throw Error(ver.error);
  expect(ver.items.length).toBeGreaterThan(0);
  expect((await verifier.getAdminHome()).queues).toEqual(expect.arrayContaining([
    expect.objectContaining({key:"entries_to_verify",count:ver.items.length}),
    expect.objectContaining({key:"artwork_arriving",count:3,overdue:1}),
  ]));
  const entries=await verifier.listQueueItems({key:"entries_to_verify"});
  if(!entries.ok)throw Error(entries.error);
  expect(entries.items.map(r=>r.id)).toEqual(ver.items.map(r=>r.entryId));
  const finance=h.as(await signedInWith(h,{role:"finance",scope:{type:"global"}}));
  const refunds=await finance.listRefunds({state:"waiting"});
  if(!refunds.ok)throw Error(refunds.error);
  expect((await finance.getAdminHome()).queues).toEqual([expect.objectContaining({key:"refunds_to_approve",count:refunds.refunds.length})]);
  const lead=h.as(await signedInWith(h,{role:"safeguarding_lead",scope:{type:"global"}}));
  const open=await lead.listSafeguardingReports();
  if(!open.ok)throw Error(open.error);
  expect((await lead.getAdminHome()).queues).toEqual([expect.objectContaining({key:"safeguarding_reports_to_review",count:2})]);
  const leadItems=await lead.listQueueItems({key:"safeguarding_reports_to_review"});
  if(!leadItems.ok)throw Error(leadItems.error);
  expect(leadItems.items.map(i=>i.id).sort()).toEqual(open.reports.map(r=>r.id).sort());
  expect(JSON.stringify(leadItems)).not.toContain("Sample Reporter");
  const admin=h.as(await signedInWith(h,{role:"super_admin",scope:{type:"global"}}));
  const home=await admin.getAdminHome();
  expect(home.queues.map(q=>q.key)).toEqual(["institutions_to_verify","results_to_approve"]);
  expect(home.queues.find(q=>q.key==="results_to_approve")?.count).toBe(1);
  await expect(admin.listQueueItems({key:"safeguarding_reports_to_review"})).rejects.toMatchObject({code:"forbidden"});
  const resultItems=await admin.listQueueItems({key:"results_to_approve"});
  if(!resultItems.ok)throw Error(resultItems.error);
  expect(resultItems.items).toHaveLength(1);
  const comps=await admin.listReportCompetitions();
  const resultComp=comps.find(c=>c.code==="RSLT27")!;
  expect(await admin.getResultsRelease({competitionId:resultComp.id})).toMatchObject({ok:true,release:{status:"pending_approval"}});
  const scoped=h.as(await signedInWith(h,{role:"competition_manager",scope:{type:"competition",id:resultComp.id}}));
  expect((await scoped.getAdminHome()).queues).toEqual([
    expect.objectContaining({key:"artwork_arriving",count:0}),expect.objectContaining({key:"results_to_approve",count:1})
  ]);
  const orig=comps.find(c=>c.code==="ORIG27")!;
  const other=h.as(await signedInWith(h,{role:"competition_manager",scope:{type:"competition",id:orig.id}}));
  expect((await other.getAdminHome()).queues).toEqual([
    expect.objectContaining({key:"artwork_arriving",count:3}),expect.objectContaining({key:"results_to_approve",count:0})
  ]);
  const arriving=await other.listQueueItems({key:"artwork_arriving"});
  if(!arriving.ok)throw Error(arriving.error);
  const requested=await other.listArtworks({competitionId:orig.id,status:"requested"});
  const dispatched=await other.listArtworks({competitionId:orig.id,status:"dispatched"});
  if(!requested.ok||!dispatched.ok)throw Error("artwork queue unavailable");
  expect(arriving.items.map(r=>r.id).sort()).toEqual([...requested.artworks,...dispatched.artworks].map(a=>a.id).sort());
  const staffAccount=await h.seed.member();
  await h.seed.grant(staffAccount,{role:"finance",scope:{type:"global"}});
  const noFactor=await h.signIn(staffAccount,undefined,{secondFactor:false});
  await expect(h.as(noFactor).getAdminHome()).rejects.toMatchObject({code:"enrolment_required"});
  await h.seed.preview();
  expect((await admin.getAdminHome()).queues).toEqual(home.queues);
});
