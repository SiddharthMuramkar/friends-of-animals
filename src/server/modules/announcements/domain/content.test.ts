import { describe, expect, it } from "vitest";

import {
  ANNOUNCEMENT_LIMITS,
  announcementContentSchema,
  announcementSections,
} from "./content";

const valid = {
  subject: "PAWS26: the drawing round is on Saturday",
  eventAt: new Date("2027-02-06T04:30:00.000Z"),
  confirmedTheme: "Animals in our neighbourhood",
  permittedMaterials: "Pencils, crayons, watercolours",
  duration: "2 hours",
  submissionSteps: "Photograph the drawing and upload it from your dashboard.",
  physicalArtworkRequirements: "A3 sheet, name on the back",
  deadlines: "Uploads close 13 February, 11:59 pm IST",
  helpContacts: "help@example.test",
  message: null,
};

describe("announcementContentSchema", () => {
  it("accepts a complete announcement", () => {
    expect(announcementContentSchema.parse(valid)).toEqual(valid);
  });

  it("trims every field and stores a blank field as missing", () => {
    const parsed = announcementContentSchema.parse({
      ...valid,
      subject: "  Saturday round  ",
      duration: "   ",
      message: "\n Bring water. \n",
    });

    expect(parsed.subject).toBe("Saturday round");
    expect(parsed.duration).toBeNull();
    expect(parsed.message).toBe("Bring water.");
  });

  it("treats a missing optional field as blank", () => {
    const parsed = announcementContentSchema.parse({
      subject: "Theme confirmed",
      confirmedTheme: "Rivers",
    });

    expect(parsed).toEqual({
      subject: "Theme confirmed",
      eventAt: null,
      confirmedTheme: "Rivers",
      permittedMaterials: null,
      duration: null,
      submissionSteps: null,
      physicalArtworkRequirements: null,
      deadlines: null,
      helpContacts: null,
      message: null,
    });
  });

  it("stores Windows line breaks as plain ones", () => {
    const parsed = announcementContentSchema.parse({
      ...valid,
      submissionSteps: "1. Photograph\r\n2. Upload",
    });

    expect(parsed.submissionSteps).toBe("1. Photograph\n2. Upload");
  });

  it("needs a subject", () => {
    const result = announcementContentSchema.safeParse({
      ...valid,
      subject: " ",
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["subject"]);
  });

  it("needs something to say beyond the subject", () => {
    const result = announcementContentSchema.safeParse({ subject: "Hello" });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("announcement_empty");
  });

  it("refuses a field over its length limit", () => {
    const result = announcementContentSchema.safeParse({
      ...valid,
      subject: "x".repeat(ANNOUNCEMENT_LIMITS.subject + 1),
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["subject"]);
  });

  it("refuses a NUL character, which Postgres text cannot store", () => {
    const result = announcementContentSchema.safeParse({
      ...valid,
      message: "before\u0000after",
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["message"]);
  });

  it("keeps markup as plain text for the renderer to escape", () => {
    const parsed = announcementContentSchema.parse({
      ...valid,
      message: "<b>Bring</b> <script>water</script>",
    });

    expect(parsed.message).toBe("<b>Bring</b> <script>water</script>");
  });
});

describe("announcementSections", () => {
  it("lists the filled sections in reading order", () => {
    const content = announcementContentSchema.parse({
      subject: "Saturday round",
      helpContacts: "help@example.test",
      eventAt: valid.eventAt,
      confirmedTheme: "Rivers",
    });

    expect(announcementSections(content)).toEqual([
      { key: "eventAt", value: valid.eventAt },
      { key: "confirmedTheme", value: "Rivers" },
      { key: "helpContacts", value: "help@example.test" },
    ]);
  });

  it("puts every field in a fixed order", () => {
    const content = announcementContentSchema.parse({
      ...valid,
      message: "See you there",
    });

    expect(announcementSections(content).map((section) => section.key)).toEqual(
      [
        "eventAt",
        "confirmedTheme",
        "permittedMaterials",
        "duration",
        "submissionSteps",
        "physicalArtworkRequirements",
        "deadlines",
        "helpContacts",
        "message",
      ]
    );
  });
});
