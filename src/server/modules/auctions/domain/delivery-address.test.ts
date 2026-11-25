import { describe, expect, it } from "vitest";

import { INDIAN_STATES, checkDeliveryAddress } from "./delivery-address";

const valid = {
  recipientName: "  Meera   Iyer ",
  line1: "Flat 4B, Sunrise Apartments",
  line2: "  ",
  city: "Mumbai",
  state: "maharashtra",
  pincode: "400 001",
};

describe("checkDeliveryAddress", () => {
  it("accepts an Indian address and tidies it", () => {
    expect(checkDeliveryAddress(valid)).toEqual({
      ok: true,
      address: {
        recipientName: "Meera Iyer",
        line1: "Flat 4B, Sunrise Apartments",
        line2: null,
        city: "Mumbai",
        state: "Maharashtra",
        pincode: "400001",
      },
    });
  });

  it("keeps a second line when there is one", () => {
    const result = checkDeliveryAddress({
      ...valid,
      line2: "Near Gandhi Park",
    });
    expect(result.ok && result.address.line2).toBe("Near Gandhi Park");
  });

  it.each(["40001", "0400001", "4000011", "40A001", ""])(
    "refuses the PIN code %j",
    (pincode) => {
      expect(checkDeliveryAddress({ ...valid, pincode })).toEqual({
        ok: false,
        errors: [{ field: "pincode", error: pincode ? "invalid" : "required" }],
      });
    }
  );

  it("refuses a state or union territory that doesn't exist", () => {
    expect(checkDeliveryAddress({ ...valid, state: "Bombay" })).toEqual({
      ok: false,
      errors: [{ field: "state", error: "invalid" }],
    });
  });

  it("names every missing required field at once", () => {
    expect(
      checkDeliveryAddress({
        recipientName: " ",
        line1: "",
        city: "",
        state: "",
        pincode: "",
      })
    ).toEqual({
      ok: false,
      errors: [
        { field: "recipientName", error: "required" },
        { field: "line1", error: "required" },
        { field: "city", error: "required" },
        { field: "state", error: "required" },
        { field: "pincode", error: "required" },
      ],
    });
  });

  it("refuses fields over their length limits", () => {
    expect(
      checkDeliveryAddress({
        ...valid,
        recipientName: "a".repeat(101),
        line1: "b".repeat(201),
        line2: "c".repeat(201),
        city: "d".repeat(101),
      })
    ).toEqual({
      ok: false,
      errors: [
        { field: "recipientName", error: "too_long" },
        { field: "line1", error: "too_long" },
        { field: "line2", error: "too_long" },
        { field: "city", error: "too_long" },
      ],
    });
  });

  it("knows all 28 states and 8 union territories", () => {
    expect(INDIAN_STATES).toHaveLength(36);
    expect(INDIAN_STATES).toContain("Dadra and Nagar Haveli and Daman and Diu");
    expect(INDIAN_STATES).toContain("Ladakh");
  });
});
