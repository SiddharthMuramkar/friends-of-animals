// Not built yet: ./phone-form-state.test.ts describes it.
import type {
  RequestPhoneCodeResult,
  VerifyPhoneCodeResult,
} from "@/server/identity";

type Entered = { phone: string; name: string };
type State = Record<string, unknown>;

export const PHONE_START: State = {};
export const PHONE_START_VIEW: State = {};

export function afterPhoneRequest(
  _result: RequestPhoneCodeResult,
  _entered: Entered,
  _from: "phone" | "code" = "phone"
): State {
  throw new Error("not built yet");
}
export function afterPhoneVerify(
  _result: Exclude<VerifyPhoneCodeResult, { ok: true }>,
  _previous: State
): State {
  throw new Error("not built yet");
}
export function afterPhoneFailure(
  _from: "phone" | "code",
  _entered: Entered
): State {
  throw new Error("not built yet");
}
