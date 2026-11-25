import { expect } from "@playwright/test";
import { readMediaFixture } from "../../src/test/media-fixtures";
import { expectAccessible, expectRendersAccessibly } from "./support/a11y";
import { drainOutbox, readEmail } from "./support/mailbox";
import { test } from "./support/seed-m2-round";
import { signInByCode } from "./support/sign-in";

for (const scope of ["all_participants", "shortlist_only"] as const) {
  test(`M2: submission through the school round (${scope})`, async ({
    page,
    request,
    seedM2Round,
  }) => {
    const world = await seedM2Round(scope);
    const query = `?institution=${world.institutionId}`;
    const base = `/institution/registrations/${world.reference}`;
    const roster = `${base}/submissions${query}`;
    const round = `${base}/school-round${query}`;
    const conduct = `${base}/conduct${query}`;
    const file = {
      name: "work.jpg",
      mimeType: "image/jpeg",
      buffer: Buffer.from(readMediaFixture("gpsJpeg")),
    };
    const student = world.students[0]!;
    await expectRendersAccessibly(page, "/sign-in");
    await signInByCode(page, request, world.adminEmail);
    await expectAccessible(page, "sessions");
    await expectRendersAccessibly(page, roster);
    if (scope === "all_participants") {
      for (const student of world.students) {
        await page.goto(roster);
        await page
          .getByRole("link", { name: `Upload work for ${student.name}` })
          .click();
        await expectAccessible(page, "student upload");
        await page
          .getByRole("textbox", { name: "Title", exact: true })
          .fill("Birds in the trees");
        await page
          .getByRole("textbox", { name: "Short description" })
          .fill("A painting of birds in our school garden.");
        await page.getByLabel("Choose an image").setInputFiles(file);
        await page
          .getByRole("button", { name: "Submit entry", exact: true })
          .click();
        await expect(
          page.getByText(new RegExp(`${world.code}-E-[0-9A-Z]{6}`))
        ).toBeVisible();
      }
      await drainOutbox(request);
      await world.processUploads();
      await drainOutbox(request);
    } else {
      await expect(
        page
          .getByText(
            "This competition takes digital work only for entries on your school’s shortlist."
          )
          .first()
      ).toBeVisible();
      await expect(
        page.getByRole("link", { name: /Upload work for/ })
      ).toHaveCount(0);
      await expectRendersAccessibly(page, round);
      await expect(
        page.getByText("Your school round isn’t open")
      ).toBeVisible();
    }
    await world.openRound();
    await expectRendersAccessibly(page, conduct);
    await page.getByRole("button", { name: "Certify conduct" }).click();
    await expect(
      page.getByText("Thank you. The competition’s conduct is certified.")
    ).toBeVisible();
    await expectAccessible(page, "certified conduct");
    await expectRendersAccessibly(page, round);
    await page.getByLabel("Full name").first().fill("Lata Kulkarni");
    await page.getByLabel("Role", { exact: true }).first().fill("Art teacher");
    await page.getByRole("button", { name: "Save panel" }).click();
    await expect(page.getByText("The panel is saved.")).toBeVisible();
    if (scope === "all_participants") {
      const category = page.getByRole("region", { name: "Drawing · Group A" });
      await category
        .getByRole("checkbox", { name: /Shortlist/ })
        .first()
        .check();
      await category
        .getByRole("combobox", { name: /School position/ })
        .first()
        .selectOption("1");
      await category.getByRole("button", { name: "Save shortlist" }).click();
      await expect(page.getByText("The shortlist is saved.")).toBeVisible();
    } else {
      await page
        .getByText(`Create shortlisted entry for ${student.name}`, {
          exact: true,
        })
        .click();
      const form = page.getByRole("form", {
        name: `Create shortlisted entry for ${student.name}`,
      });
      await expectAccessible(page, "open shortlisted entry form");
      await form.getByLabel("Discipline").selectOption("drawing");
      await form.getByLabel("Title (required)").fill("Birds in the trees");
      await form
        .getByLabel("Short description (required)")
        .fill("A painting of birds in our school garden.");
      await form.getByLabel("School position (optional)").selectOption("1");
      await form
        .getByLabel("Choose digital work (required)")
        .setInputFiles(file);
      for (const checkbox of await form.getByRole("checkbox").all())
        await checkbox.check();
      await form
        .getByRole("button", { name: "Create shortlisted entry" })
        .click();
      await expect(
        page.getByText(new RegExp(`${world.code}-E-[0-9A-Z]{6}`))
      ).toBeVisible();
      await expect(
        page.getByText("School shortlisted", { exact: true })
      ).toBeVisible();
      await drainOutbox(request);
      await world.processUploads();
      await drainOutbox(request);
      await expectRendersAccessibly(page, round);
      await expect(
        page.getByText("The upload passed its checks.")
      ).toBeVisible();
    }
    await page.getByLabel("I confirm the statement above").check();
    await page.getByRole("button", { name: "Finalise school round" }).click();
    await expect(
      page.getByText(
        "Your school round is finalised. Families are being told the outcome."
      )
    ).toBeVisible();
    await expectAccessible(page, "finalised school round");
    await drainOutbox(request);
    if (scope === "shortlist_only")
      await expect(
        page.getByText("Submitted to FOA", { exact: true })
      ).toBeVisible();
    {
      const message = await readEmail(
        request,
        world.students[1]!.email,
        `School judging finished for M2 School Art ${world.code}`
      );
      expect(message.text).toContain(world.students[1]!.name);
    }
  });
}
