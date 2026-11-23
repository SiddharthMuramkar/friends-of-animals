import { describe, expect, it } from "vitest";

import { fieldsFromForm } from "./form-data";

function form(entries: [string, string][]): FormData {
  const data = new FormData();
  for (const [name, value] of entries) data.append(name, value);
  return data;
}

describe("fieldsFromForm", () => {
  it("reads every field the competition form submits", () => {
    const fields = fieldsFromForm(
      form([
        ["code", " paws27 "],
        ["name", "Paws"],
        ["theme", "Kindness"],
        ["welfareMessage", "Water and shade"],
        ["rules", "One entry each"],
        ["permittedMaterials", "Crayons"],
        ["duration", "2 hours"],
        ["participation", "both"],
        ["disciplines", "painting"],
        ["disciplines", "drawing"],
        ["ageGroup.label", "Juniors"],
        ["ageGroup.minAge", "5"],
        ["ageGroup.maxAge", "8"],
        ["ageGroup.label", "Seniors"],
        ["ageGroup.minAge", "9"],
        ["ageGroup.maxAge", "12"],
        ["categories", "drawing:0"],
        ["categories", "painting:1"],
        ["ageCutoffDate", "2027-01-01"],
        ["digitalScope", "shortlist_only"],
        ["shortlistPerCategory", "6"],
        ["schoolPositions", "3"],
        ["physicalArtwork", "top_n"],
        ["physicalArtworkTopN", "4"],
        ["publicDisplay", "on"],
        ["keyDates.registration_opens", "2027-01-15T10:00"],
        ["keyDates.registration_closes", ""],
      ])
    );

    expect(fields).toEqual({
      code: " paws27 ",
      name: "Paws",
      theme: "Kindness",
      welfareMessage: "Water and shade",
      rules: "One entry each",
      permittedMaterials: "Crayons",
      duration: "2 hours",
      participation: "both",
      disciplines: ["painting", "drawing"],
      ageGroups: [
        { label: "Juniors", minAge: 5, maxAge: 8 },
        { label: "Seniors", minAge: 9, maxAge: 12 },
      ],
      categories: [
        { discipline: "drawing", ageGroup: "Juniors" },
        { discipline: "painting", ageGroup: "Seniors" },
      ],
      ageCutoffDate: "2027-01-01",
      digitalScope: "shortlist_only",
      shortlistPerCategory: 6,
      schoolPositions: 3,
      physicalArtwork: { kind: "top_n", count: 4 },
      publicDisplay: true,
      auctionPermitted: false,
      keyDates: { registration_opens: "2027-01-15T10:00" },
    });
  });

  it("leaves what the use case should refuse for it to refuse", () => {
    const fields = fieldsFromForm(
      form([
        ["participation", "everyone"],
        ["disciplines", "juggling"],
        ["ageGroup.label", "Juniors"],
        ["ageGroup.minAge", ""],
        ["ageGroup.maxAge", "8.5"],
        ["categories", "drawing:7"],
        ["shortlistPerCategory", "five"],
        ["physicalArtwork", "some"],
      ])
    );

    expect(fields).toMatchObject({
      code: "",
      name: "",
      participation: "everyone",
      disciplines: ["juggling"],
      ageGroups: [{ label: "Juniors", minAge: Number.NaN, maxAge: Number.NaN }],
      categories: [{ discipline: "drawing", ageGroup: "" }],
      shortlistPerCategory: Number.NaN,
      physicalArtwork: { kind: "some" },
    });
  });

  it("reads no participation, no discipline and no category as none", () => {
    expect(fieldsFromForm(form([]))).toMatchObject({
      participation: null,
      disciplines: [],
      ageGroups: [],
      categories: [],
      physicalArtwork: { kind: "" },
      publicDisplay: false,
      auctionPermitted: false,
      keyDates: {},
    });
  });
});
