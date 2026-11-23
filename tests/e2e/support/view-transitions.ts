import type { Page } from "@playwright/test";

type Counter = { viewTransitionsStarted: number };

/** Counts view transitions on each subsequent page load without changing them. */
export async function countViewTransitions(
  page: Page
): Promise<() => Promise<number>> {
  await page.addInitScript(() => {
    const counter = window as unknown as Counter;
    counter.viewTransitionsStarted = 0;
    const start = document.startViewTransition.bind(document);
    document.startViewTransition = (...args) => {
      counter.viewTransitionsStarted += 1;
      return start(...args);
    };
  });
  return () =>
    page.evaluate(() => (window as unknown as Counter).viewTransitionsStarted);
}
