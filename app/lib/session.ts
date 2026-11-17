import { createCookieSessionStorage, type SessionStorage } from "react-router";
import { env } from "~/lib/env.server";

let storage: SessionStorage | undefined;

// Created lazily so importing this module doesn't validate env at build time.
function getSessionStorage(): SessionStorage {
  if (!storage) {
    const config = env();
    storage = createCookieSessionStorage({
      cookie: {
        name: "rescue_session",
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: config.NODE_ENV === "production",
        secrets: [config.SESSION_SECRET],
      },
    });
  }
  return storage;
}

export async function getSession(request: Request) {
  return getSessionStorage().getSession(request.headers.get("Cookie"));
}

export async function getCurrentUserId(request: Request): Promise<number | null> {
  const session = await getSession(request);
  const userId = session.get("userId");
  return typeof userId === "number" ? userId : null;
}

export async function setCurrentUserId(request: Request, userId: number) {
  const session = await getSession(request);
  session.set("userId", userId);
  return getSessionStorage().commitSession(session);
}

export async function destroySession(request: Request) {
  const session = await getSession(request);
  return getSessionStorage().destroySession(session);
}
