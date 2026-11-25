import { expect, test } from "@playwright/test";

test("the about and contact pages link to existing animal help, adoption and volunteering options", async ({
  page,
}) => {
  for (const path of ["/about", "/contact"]) {
    await page.goto(path);
    const main = page.getByRole("main");
    await expect(
      main.getByRole("link", { name: "Find animal help" })
    ).toHaveAttribute("href", "/ngos");
    await expect(
      main.getByRole("link", { name: "Adopt an animal" })
    ).toHaveAttribute("href", "/adopt");
    await expect(
      main.getByRole("link", { name: "Check volunteering options" })
    ).toHaveAttribute("href", "/dashboard/volunteer");
  }
});

test("changing the contact topic preserves a draft without submitting it through safeguarding", async ({
  page,
}) => {
  await page.goto("/contact");
  const form = page
    .getByRole("region", { name: "Send us a message" })
    .locator("form");
  await form.getByRole("radio", { name: "General" }).check();
  const name = form.getByRole("textbox", { name: "Your name" });
  const message = form.getByRole("textbox", { name: "Your message" });
  await name.fill("Asha");
  await message.fill("I have a question about your website.");
  await form.getByRole("radio", { name: "Safeguarding concern" }).check();
  await expect(
    form.getByRole("link", { name: "Go to the safeguarding page" })
  ).toBeVisible();
  await expect(form.getByRole("button", { name: "Send message" })).toHaveCount(
    0
  );
  expect(
    await form.evaluate((element: HTMLFormElement) =>
      Object.fromEntries(new FormData(element))
    )
  ).toEqual({ topic: "SAFEGUARDING" });

  await form.getByRole("radio", { name: "General" }).check();
  await expect(name).toHaveValue("Asha");
  await expect(message).toHaveValue("I have a question about your website.");
});

test("donation choices retain a draft but exclude inactive fields from the submission", async ({
  page,
}) => {
  await page.goto("/donate");
  const form = page.getByRole("main").locator("form");
  await expect(form).toHaveAttribute("method", "post");
  const other = form.getByRole("radio", { name: "Another amount" });
  const amount = form.getByRole("textbox", { name: "Amount in rupees" });
  const company = form.getByRole("radio", { name: "A company", exact: true });
  const companyName = form.getByRole("textbox", { name: "Company name" });
  const disclose = form.getByRole("radio", {
    name: "No, keep our name private",
  });
  const wall = form.getByRole("checkbox", {
    name: "Show my gift on the donor wall",
  });
  const wallName = form.getByRole("textbox", { name: "Name on the wall" });

  await other.check();
  await amount.fill("850.50");
  await company.check();
  await companyName.fill("Example company");
  await disclose.check();
  await wall.check();
  await wallName.fill("Example name");

  await form.getByRole("radio", { name: "₹500", exact: true }).check();
  await form.getByRole("radio", { name: "Me, as a person" }).check();
  await wall.uncheck();
  for (const field of [amount, companyName, disclose, wallName]) {
    await expect(field).toHaveCount(0);
  }
  const inactive = await form.evaluate((element: HTMLFormElement) =>
    Object.fromEntries(new FormData(element))
  );
  expect(inactive).not.toHaveProperty("otherAmount");
  expect(inactive).not.toHaveProperty("organisationName");
  expect(inactive).not.toHaveProperty("disclose");
  expect(inactive).not.toHaveProperty("wallName");

  await other.check();
  await company.check();
  await wall.check();
  await expect(amount).toHaveValue("850.50");
  await expect(companyName).toHaveValue("Example company");
  await expect(disclose).toBeChecked();
  await expect(wallName).toHaveValue("Example name");
});
