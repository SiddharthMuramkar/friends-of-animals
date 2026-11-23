import { expect, type Page } from "@playwright/test";

/** The gateways a journey can pay through outside production. */
export type TestGateway = "fallback" | "razorpay-test";

/**
 * Pays in whichever checkout the pay page's island just opened, and says
 * which it was. The app decides, never the test: the fallback gateway's
 * test checkout where no Razorpay keys are set (CI, local runs), Razorpay's
 * Checkout in test mode where they are (HR-09). The page that shows the
 * payment then says which gateway made the order (data-gateway).
 */
export async function payInOpenCheckout(page: Page): Promise<TestGateway> {
  const testCheckout = page.getByRole("region", { name: "Test checkout" });
  const razorpay = page.locator("iframe.razorpay-checkout-frame");
  await expect(testCheckout.or(razorpay)).toBeVisible();

  if (await testCheckout.isVisible()) {
    await testCheckout.getByRole("button", { name: "Pay (test)" }).click();
    return "fallback";
  }
  await payInRazorpayTestMode(page);
  return "razorpay-test";
}

/**
 * Razorpay's Standard Checkout in test mode, paid by netbanking: any bank
 * opens Razorpay's mock bank page, whose Success button pays
 * (razorpay.com/docs/payments/payment-gateway/web-integration/standard/
 * integration-steps, "Test Integration"). Not yet run against a deployment
 * with test keys (HR-09): check these steps when R-RZP-E2E runs.
 */
async function payInRazorpayTestMode(page: Page): Promise<void> {
  const checkout = page.frameLocator("iframe.razorpay-checkout-frame");
  await checkout.getByText("Netbanking", { exact: false }).first().click();
  await checkout.getByText("SBI", { exact: false }).first().click();
  const bankPage = page.waitForEvent("popup");
  await checkout.getByRole("button", { name: /^Pay/ }).click();
  const bank = await bankPage;
  await bank.getByRole("button", { name: "Success" }).click();
}
