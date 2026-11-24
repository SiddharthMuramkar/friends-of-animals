import { describe, expect, it } from "vitest";

import {
  announcementFormView,
  formViewForRefusal,
  readAnnouncementForm,
} from "./form";

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(values)) data.set(name, value);
  return data;
}

describe("readAnnouncementForm", () => {
  it("reads every section, the event's IST date and time as an instant, and blanks as null", () => {
    const read = readAnnouncementForm(
      form({
        subject: "The drawing day",
        eventAt: "2027-02-06T10:00",
        confirmedTheme: "Street dogs",
        permittedMaterials: "",
        duration: "Two hours",
        submissionSteps: "",
        physicalArtworkRequirements: "",
        deadlines: "",
        helpContacts: "",
        message: "",
      })
    );

    expect(read).toEqual({
      ok: true,
      content: {
        subject: "The drawing day",
        eventAt: new Date("2027-02-06T04:30:00.000Z"),
        confirmedTheme: "Street dogs",
        permittedMaterials: null,
        duration: "Two hours",
        submissionSteps: null,
        physicalArtworkRequirements: null,
        deadlines: null,
        helpContacts: null,
        message: null,
      },
    });
  });

  it("refuses a date and time that doesn't exist, keeping what was typed", () => {
    const read = readAnnouncementForm(
      form({ subject: "Hi", eventAt: "2027-02-30T10:00" })
    );

    expect(read).toEqual({
      ok: false,
      fields: ["eventAt"],
      values: expect.objectContaining({
        subject: "Hi",
        eventAt: "2027-02-30T10:00",
      }),
    });
  });
});

describe("the form's view", () => {
  it("fills the fields from saved content, the event in IST", () => {
    const view = announcementFormView({
      subject: "The drawing day",
      eventAt: new Date("2027-02-06T04:30:00.000Z"),
      confirmedTheme: null,
      permittedMaterials: null,
      duration: null,
      submissionSteps: null,
      physicalArtworkRequirements: null,
      deadlines: null,
      helpContacts: "Write to us",
      message: null,
    });

    expect(view.values).toMatchObject({
      subject: "The drawing day",
      eventAt: "2027-02-06T10:00",
      confirmedTheme: "",
      helpContacts: "Write to us",
    });
    expect(view.errors).toEqual({});
  });

  it("marks each field at fault and keeps what was typed", () => {
    const view = formViewForRefusal(
      { subject: "", eventAt: "", duration: "x" },
      ["subject", "duration", "sections"]
    );

    expect(view.errors).toEqual({ subject: "subject", duration: "field" });
    expect(view.alert).toEqual(["sections"]);
    expect(view.values.duration).toBe("x");
  });
});
