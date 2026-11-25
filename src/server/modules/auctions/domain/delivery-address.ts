// The address a sold artwork is sent to (#133). Checks and tidies what the
// buyer typed: a recipient, one or two address lines, a city, an Indian
// state or union territory, and a six-digit PIN code that doesn't start
// with 0. The phone number is checked separately with the shared Indian
// phone normaliser (#58). The use case stores every field encrypted.
//
// Pure. Loads under plain Node: no imports.

/** The 28 states and 8 union territories, by their official names. */
export const INDIAN_STATES = [
  "Andhra Pradesh",
  "Arunachal Pradesh",
  "Assam",
  "Bihar",
  "Chhattisgarh",
  "Goa",
  "Gujarat",
  "Haryana",
  "Himachal Pradesh",
  "Jharkhand",
  "Karnataka",
  "Kerala",
  "Madhya Pradesh",
  "Maharashtra",
  "Manipur",
  "Meghalaya",
  "Mizoram",
  "Nagaland",
  "Odisha",
  "Punjab",
  "Rajasthan",
  "Sikkim",
  "Tamil Nadu",
  "Telangana",
  "Tripura",
  "Uttar Pradesh",
  "Uttarakhand",
  "West Bengal",
  "Andaman and Nicobar Islands",
  "Chandigarh",
  "Dadra and Nagar Haveli and Daman and Diu",
  "Delhi",
  "Jammu and Kashmir",
  "Ladakh",
  "Lakshadweep",
  "Puducherry",
] as const;

export type IndianState = (typeof INDIAN_STATES)[number];

export type DeliveryAddressInput = {
  recipientName: string;
  line1: string;
  line2?: string | null;
  city: string;
  state: string;
  pincode: string;
};

export type DeliveryAddress = {
  recipientName: string;
  line1: string;
  line2: string | null;
  city: string;
  state: IndianState;
  pincode: string;
};

export type AddressFieldError = {
  field: keyof DeliveryAddressInput;
  error: "required" | "too_long" | "invalid";
};

export type DeliveryAddressCheck =
  | { ok: true; address: DeliveryAddress }
  | { ok: false; errors: AddressFieldError[] };

const MAX_LENGTH = { recipientName: 100, line1: 200, line2: 200, city: 100 };

const PINCODE = /^[1-9]\d{5}$/;

const STATE_BY_KEY = new Map<string, IndianState>(
  INDIAN_STATES.map((state) => [state.toLowerCase(), state])
);

function tidy(text: string | null | undefined): string {
  return (text ?? "").trim().replace(/\s+/g, " ");
}

/** Whether the address is complete and valid; if so, its tidied form. */
export function checkDeliveryAddress(
  input: DeliveryAddressInput
): DeliveryAddressCheck {
  const errors: AddressFieldError[] = [];
  const text = (field: keyof typeof MAX_LENGTH, required: boolean) => {
    const value = tidy(input[field]);
    if (required && value === "") errors.push({ field, error: "required" });
    else if (value.length > MAX_LENGTH[field]) {
      errors.push({ field, error: "too_long" });
    }
    return value;
  };

  const recipientName = text("recipientName", true);
  const line1 = text("line1", true);
  const line2 = text("line2", false);
  const city = text("city", true);

  const stateText = tidy(input.state);
  const state = STATE_BY_KEY.get(stateText.toLowerCase());
  if (stateText === "") errors.push({ field: "state", error: "required" });
  else if (!state) errors.push({ field: "state", error: "invalid" });

  const pincode = input.pincode.replace(/\s+/g, "");
  if (pincode === "") errors.push({ field: "pincode", error: "required" });
  else if (!PINCODE.test(pincode)) {
    errors.push({ field: "pincode", error: "invalid" });
  }

  if (errors.length > 0 || !state) return { ok: false, errors };
  return {
    ok: true,
    address: {
      recipientName,
      line1,
      line2: line2 === "" ? null : line2,
      city,
      state,
      pincode,
    },
  };
}
