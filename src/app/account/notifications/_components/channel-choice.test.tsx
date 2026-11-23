import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ChannelChoice } from "./channel-choice";

function html() {
  return renderToStaticMarkup(
    <ChannelChoice
      id="channel-email"
      name="email"
      label="Email"
      defaultChecked
      hint={<p>To asha@example.test</p>}
    />
  );
}

describe("<ChannelChoice>", () => {
  // Spec 1.8: targets are at least 44 px (min-h-11). A 24 px box alone is
  // too small, so the box and its name share one label that tall.
  it("puts the box and its name in one label at least 44 px tall", () => {
    expect(html()).toMatch(
      /<label[^>]* class="[^"]*\bmin-h-11\b[^"]*"[^>]*><input[^>]* type="checkbox"[^>]*>.*Email.*<\/label>/
    );
  });

  it("points the box at its hint", () => {
    const box = html().match(/<input[^>]*>/)?.[0];

    expect(box).toContain(' name="email"');
    expect(box).toContain(' aria-describedby="channel-email-hint"');
    expect(html()).toMatch(
      /id="channel-email-hint"[^>]*><p>To asha@example.test<\/p>/
    );
  });
});
