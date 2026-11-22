import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DesktopNavView, MenuLinksView } from "./header-nav";

const items = [{ href: "/about", label: "About" }];
const dashboard = { href: "/dashboard", label: "Dashboard" };

const desktop = (pathname: string | null) =>
  renderToStaticMarkup(
    <DesktopNavView
      items={items}
      dashboard={dashboard}
      label="Main"
      pathname={pathname}
    />
  );

// The phone menu's links, the only part of it that reads the pathname.
const menu = (pathname: string | null) =>
  renderToStaticMarkup(
    <MenuLinksView
      items={items}
      dashboard={dashboard}
      donateHref="/donate"
      pathname={pathname}
      close={() => {}}
    />
  );

describe("the header's Dashboard link", () => {
  it("shows on pages behind sign-in, where the visitor is signed in", () => {
    for (const pathname of [
      "/dashboard",
      "/admin/roles",
      "/account/sessions",
    ]) {
      expect(desktop(pathname), pathname).toContain('href="/dashboard"');
      expect(menu(pathname), pathname).toContain('href="/dashboard"');
    }
  });

  it("marks itself current on the dashboard", () => {
    expect(desktop("/dashboard")).toMatch(
      /<a[^>]*aria-current="page"[^>]*href="\/dashboard"|<a[^>]*href="\/dashboard"[^>]*aria-current="page"/
    );
  });

  it("stays off public pages, which never read the session", () => {
    for (const pathname of ["/", "/about", "/sign-in", null]) {
      expect(desktop(pathname), String(pathname)).not.toContain("/dashboard");
      expect(menu(pathname), String(pathname)).not.toContain("/dashboard");
    }
  });
});
