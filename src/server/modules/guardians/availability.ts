import type { Env } from "../../../env.schema";

export function guardianFlowsActive(appEnv: Env["APP_ENV"]): boolean {
  // HR-32/33: guardian setup and minor participation wait for owner sign-off.
  return appEnv === "local" || appEnv === "preview";
}
