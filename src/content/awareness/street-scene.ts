import { z } from "zod";

import { SITE_ART_IDS } from "@/lib/art/ids";

import { NEIGHBOURS } from "./neighbours";

/**
 * "Spot the neighbour": where each of the ten neighbours sits in the street
 * illustration on /awareness, as percentages of its width and height
 * (checked by eye with scripts/site-art/overlay.ts). Each spot links to the
 * neighbour's card below the picture.
 *
 * `label` is the side of the ring its name shows on once the picture is wide
 * enough for names beside the rings (street-scene.module.css): "beside" is
 * to its right. Each side was measured so that no shown name covers another
 * ring at any width from there up; move a spot, and check its side again.
 */
const spotSchema = z.strictObject({
  neighbour: z.enum(NEIGHBOURS.map((n) => n.id) as [string, ...string[]]),
  x: z.number().min(0).max(100),
  y: z.number().min(0).max(100),
  label: z.enum(["above", "below", "beside"]),
});

export const STREET_SCENE = z
  .strictObject({
    artId: z.enum(SITE_ART_IDS),
    spots: z.array(spotSchema).length(NEIGHBOURS.length),
  })
  .refine(
    (s) => new Set(s.spots.map((p) => p.neighbour)).size === s.spots.length,
    { message: "each neighbour has one spot", path: ["spots"] }
  )
  .parse({
    artId: "scene-street-neighbours",
    // Left to right, the order a keyboard user tabs through them.
    spots: [
      { neighbour: "rock-pigeon", x: 8.3, y: 26.7, label: "below" },
      { neighbour: "indie-dog", x: 13.5, y: 76.7, label: "below" },
      { neighbour: "black-kite", x: 14.5, y: 9, label: "beside" },
      { neighbour: "street-cat", x: 28.4, y: 56.6, label: "above" },
      { neighbour: "palm-squirrel", x: 30.5, y: 27.3, label: "below" },
      { neighbour: "house-crow", x: 47.9, y: 41, label: "below" },
      { neighbour: "common-myna", x: 48.5, y: 18.1, label: "above" },
      { neighbour: "house-sparrow", x: 66.5, y: 46.5, label: "above" },
      { neighbour: "cow", x: 84, y: 71, label: "above" },
      { neighbour: "asian-koel", x: 92.7, y: 17.2, label: "above" },
    ],
  });
