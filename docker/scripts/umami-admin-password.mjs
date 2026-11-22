// Replaces Umami's seeded admin login (admin / umami, which everyone knows)
// with the password on stdin (#118). analytics-bootstrap.sh runs it inside
// foa-umami, against Umami's own port, right after starting Umami:
//
//   docker exec -i foa-umami node --input-type=module -e "$(<this file)" <password-file
//
// The password arrives on stdin, never as an argument, and is never printed.
// Exits 0 once the seeded login no longer works. FOA_UMAMI_URL overrides
// http://127.0.0.1:3000 (tests). Umami 3.5's API: POST /api/auth/login, then
// POST /api/me/password with the session token.

const base = process.env.FOA_UMAMI_URL || "http://127.0.0.1:3000";
const seeded = { username: "admin", password: "umami" };

function fail(message) {
  console.error(`umami-admin-password: ${message}`);
  process.exit(1);
}

async function post(path, body, token) {
  try {
    return await fetch(new URL(path, base), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token !== undefined && { authorization: `Bearer ${token}` }),
      },
      body: JSON.stringify(body),
    });
  } catch {
    return fail(`can't reach Umami at ${base}`);
  }
}

let input = "";
for await (const chunk of process.stdin) input += chunk;
const password = input.trim();
if (!/^[0-9a-f]{64}$/.test(password)) {
  fail("expected the new password on stdin, 64 hex characters");
}

const login = await post("/api/auth/login", seeded);
if (login.status === 401) {
  const own = await post("/api/auth/login", { ...seeded, password });
  if (own.ok) {
    console.log("kept the admin password");
  } else {
    console.error(
      "umami-admin-password: the seeded admin login is gone, but the stored " +
        "password doesn't sign in: put the current one in the password file"
    );
  }
  process.exit(0);
}
if (!login.ok) {
  fail(`signing in as admin failed: HTTP ${login.status}`);
}
const { token } = await login.json().catch(() => ({}));
if (typeof token !== "string") {
  fail("signing in as admin gave no session: change it in the dashboard");
}

const change = await post(
  "/api/me/password",
  { currentPassword: seeded.password, newPassword: password },
  token
);
if (!change.ok) {
  fail(`changing the admin password failed: HTTP ${change.status}`);
}

const check = await post("/api/auth/login", seeded);
if (check.status !== 401) {
  fail(`the seeded admin login still works (HTTP ${check.status})`);
}
console.log("replaced the seeded admin login");
