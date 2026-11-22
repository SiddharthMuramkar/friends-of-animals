import { spawnSync } from "node:child_process";
import {
  accessSync,
  chmodSync,
  constants,
  chownSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

// The sweeper's post-drop hooks (#63): after each DROP DATABASE the sweeper
// runs run-preview-dropped-hooks.sh, which runs every hook in
// preview-dropped.d with the dropped database's name. 50-purge-files.sh
// purges that preview's files with the worker image. `docker` and `curl`
// are stand-ins on PATH that record what they were asked to do.

const HERE = fileURLToPath(new URL(".", import.meta.url));
const SWEEPER = join(HERE, "sweep-preview-dbs.sh");
const RUNNER = join(HERE, "run-preview-dropped-hooks.sh");
const PURGE_HOOK = join(HERE, "preview-dropped.d", "50-purge-files.sh");
const REPO = join(HERE, "../..");
const RUN_AS_NOBODY = process.getuid?.() === 0;

const DB = "foa_pr_12_0123abcd";
const SECRET = "nonprod-secret-must-not-reach-argv";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true });
});

function tempDir(base = tmpdir()) {
  const dir = mkdtempSync(join(base, "foa-preview-dropped-"));
  if (RUN_AS_NOBODY) chownSync(dir, 65534, 65534);
  dirs.push(dir);
  return dir;
}

/**
 * A folder for the sweeper's purge records, which it fsyncs. On a disk
 * (CI's /tmp) the first fsync waits for everything the runner has left
 * unwritten, seconds after an install; on tmpfs it returns at once.
 */
function syncedStateDir() {
  try {
    accessSync("/dev/shm", constants.W_OK);
    return tempDir("/dev/shm");
  } catch {
    return tempDir();
  }
}

function fixturePath(dir: string) {
  const bin = join(dir, "bin");
  mkdirSync(bin);
  for (const tool of [
    "bash",
    "basename",
    "base64",
    "cat",
    "dirname",
    "flock",
    "grep",
    "jq",
    "mkdir",
    "mktemp",
    "mv",
    "rm",
    "sha256sum",
    "sync",
    "timeout",
  ]) {
    const path = ["/usr/bin", "/bin", "/usr/local/bin", "/opt/homebrew/bin"]
      .map((prefix) => join(prefix, tool))
      .find(existsSync);
    if (!path) throw new Error(`Missing fixture utility: ${tool}`);
    symlinkSync(path, join(bin, tool));
  }
  return bin;
}

function writeScript(path: string, body: string) {
  writeFileSync(path, `#!/usr/bin/env bash\n${body}\n`);
  chmodSync(path, 0o755);
}

/**
 * A bin directory whose `docker` logs each call's arguments (one per line,
 * then "--") to `docker.log`. For `docker exec … psql -c <query>` it prints
 * `rows`; for `docker exec … psql` fed by stdin it logs the statement to
 * `sql.log`; for `docker run` it exits with $FAKE_DOCKER_EXIT. `curl`
 * answers every PR as closed.
 */
function fakeBin(rows = "") {
  const dir = tempDir();
  const bin = fixturePath(dir);
  writeFileSync(join(dir, "rows.tsv"), rows);
  writeScript(
    join(bin, "docker"),
    `printf '%s\\n' "$EUID" >"${dir}/uid.log"
printf '%s\\n' "$@" -- >>"${dir}/docker.log"
if [ "$1" = exec ]; then
  query=""
  for arg in "$@"; do
    if [ "$query" = yes ]; then
      while IFS=$'\t' read -r name comment || [ -n "$name" ]; do
        if [ -f "${dir}/sql.log" ] && grep -Fq "DROP DATABASE IF EXISTS \\"$name\\"" "${dir}/sql.log"; then
          continue
        fi
        if [[ "$arg" == *shobj_description* ]]; then
          [[ "$comment" == "foa-preview "* ]] && printf '%s\\t%s\\n' "$name" "$comment"
        else
          printf '%s\\n' "$name"
        fi
      done <"${dir}/rows.tsv"
      exit 0
    fi
    if [ "$arg" = -c ]; then query=yes; fi
  done
  cat >>"${dir}/sql.log"
  exit 0
fi
exit "\${FAKE_DOCKER_EXIT:-0}"`
  );
  // It reads its config (the token header) from stdin, as curl does; left
  // unread, the sweeper's pipe could fail and the PR read as unknown.
  writeScript(
    join(bin, "curl"),
    `cat >/dev/null\nprintf '{"state":"%s"}\\n' "\${FAKE_PR_STATE:-closed}"`
  );
  writeScript(join(bin, "git"), 'exit "${FAKE_GIT_EXIT:-2}"');
  const read = (name: string) =>
    existsSync(join(dir, name)) ? readFileSync(join(dir, name), "utf8") : "";
  return {
    dir,
    path: bin,
    uid: () => Number(read("uid.log").trim()),
    dockerCalls: () =>
      read("docker.log")
        .split("--\n")
        .filter(Boolean)
        .map((call) => call.split("\n").filter(Boolean)),
    sql: () => read("sql.log"),
  };
}

function run(
  script: string,
  args: string[],
  env: Record<string, string>,
  bashOptions: string[] = []
) {
  const bash = ["/bin/bash", ...bashOptions, script, ...args];
  const [command, ...argv] = RUN_AS_NOBODY
    ? [
        "/usr/bin/setpriv",
        "--no-new-privs",
        "--reuid=65534",
        "--regid=65534",
        "--clear-groups",
        "--",
        ...bash,
      ]
    : bash;
  const result = spawnSync(command, argv, {
    encoding: "utf8",
    cwd: dirname(script),
    env: { NODE_ENV: "test", HOME: dirname(script), ...env },
  });
  if (result.error) throw result.error;
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

describe("the scripts' syntax", () => {
  it.each([SWEEPER, RUNNER, PURGE_HOOK])("bash -n passes on %s", (path) => {
    const dir = tempDir();
    const script = join(dir, basename(path));
    copyFileSync(path, script);
    expect(run(script, [], { PATH: fixturePath(dir) }, ["-n"]).status).toBe(0);
  });
});

describe("50-purge-files.sh", () => {
  /** The hook with a non-production credentials file and a fake docker. */
  function world(
    envFile = `R2_ACCOUNT_ID=0123\nR2_SECRET_ACCESS_KEY=${SECRET}\n`
  ) {
    const bin = fakeBin();
    const hook = join(bin.dir, basename(PURGE_HOOK));
    copyFileSync(PURGE_HOOK, hook);
    const credentials = join(bin.dir, "preview-files.env");
    writeFileSync(credentials, envFile);
    const env = {
      PATH: bin.path,
      FOA_PREVIEW_FILES_ENV: credentials,
    };
    return { bin, credentials, env, hook };
  }

  it("runs the purge command in the worker image for the database in $1", () => {
    const { bin, credentials, env, hook } = world();

    const result = run(hook, [DB], env);

    expect(result.status).toBe(0);
    expect(bin.uid()).toBeGreaterThan(0);
    const compose = readFileSync(join(REPO, "docker/workers.yml"), "utf8");
    const previewImage =
      /^  worker-preview:\n(?:(?:    .*|)\n)*?    image: (\S+)/m.exec(
        compose
      )?.[1];
    expect(previewImage).toBe("foa-workers/worker-preview");
    expect(bin.dockerCalls()).toEqual([
      [
        "run",
        "--rm",
        "--pull",
        "never",
        "--cap-drop",
        "ALL",
        "--security-opt",
        "no-new-privileges",
        "--env-file",
        credentials,
        "--env",
        "APP_ENV=preview",
        previewImage,
        "pnpm",
        "files:purge-preview",
        "--database",
        DB,
      ],
    ]);
  });

  it("packs the package command and its CLI modules in the worker stage", () => {
    const dockerfile = readFileSync(join(REPO, "Dockerfile"), "utf8");
    const workerStage = dockerfile
      .split(/^FROM .* AS worker$/m)[1]
      ?.split(/^FROM /m)[0];
    expect(workerStage).toBeDefined();
    const image = tempDir();
    mkdirSync(join(image, "scripts"));
    for (const line of workerStage!
      .split("\n")
      .filter((line) => line.startsWith("COPY "))) {
      const [, ...paths] = line.trim().split(/\s+/);
      const destination = paths.pop()!;
      for (const source of paths.filter((path) =>
        /^scripts\/[^/]+\.ts$/.test(path)
      )) {
        const target = destination.endsWith("/")
          ? join(destination, basename(source))
          : destination;
        copyFileSync(join(REPO, source), join(image, target));
      }
      if (destination === "./" && paths.includes("package.json")) {
        copyFileSync(join(REPO, "package.json"), join(image, "package.json"));
      }
    }
    const manifest = JSON.parse(
      readFileSync(join(image, "package.json"), "utf8")
    );
    const entry = /^tsx (scripts\/\S+)$/.exec(
      manifest.scripts["files:purge-preview"]
    )?.[1];
    expect(entry).toBe("scripts/purge-preview-files.ts");
    expect(existsSync(join(image, entry!))).toBe(true);
    expect(existsSync(join(image, "scripts/purge-preview-files-cli.ts"))).toBe(
      true
    );
    expect(existsSync(join(image, "scripts/load-env.ts"))).toBe(true);
  });

  it("uses FOA_WORKER_IMAGE when it is set", () => {
    const { bin, env, hook } = world();

    run(hook, [DB], { ...env, FOA_WORKER_IMAGE: "foa-worker:abc123" });

    expect(bin.dockerCalls()[0]).toContain("foa-worker:abc123");
  });

  it("never puts a credential on docker's command line", () => {
    const { bin, env, hook } = world();

    run(hook, [DB], env);

    expect(bin.dockerCalls().flat().join(" ")).not.toContain(SECRET);
  });

  it("fails when the purge command fails", () => {
    const { env, hook } = world();

    const result = run(hook, [DB], { ...env, FAKE_DOCKER_EXIT: "1" });

    expect(result.status).not.toBe(0);
  });

  it.each([
    ["no name", []],
    ["an empty name", [""]],
    ["the seed template", ["foa_seed"]],
    ["the production database", ["foa"]],
    ["staging's database", ["foa_staging"]],
    ["a name with a space", [`${DB} extra`]],
    ["an upper-case name", ["FOA_PR_12_0123ABCD"]],
  ])("refuses %s without running docker", (_, args) => {
    const { bin, env, hook } = world();

    const result = run(hook, args, env);

    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/not a preview database/);
    expect(bin.dockerCalls()).toEqual([]);
  });

  it("fails without the non-production credentials file, naming it", () => {
    const { bin, env, hook } = world();

    const result = run(hook, [DB], {
      ...env,
      FOA_PREVIEW_FILES_ENV: join(bin.dir, "missing.env"),
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("missing.env");
    expect(bin.dockerCalls()).toEqual([]);
  });

  it.each([
    "APP_ENV=production",
    "export APP_ENV=staging",
    "  APP_ENV=preview",
  ])("refuses a credentials file that sets %s", (line) => {
    const { bin, env, hook } = world(`R2_BUCKET=foa-files-nonprod\n${line}\n`);

    const result = run(hook, [DB], env);

    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/APP_ENV/);
    expect(bin.dockerCalls()).toEqual([]);
  });
});

describe("run-preview-dropped-hooks.sh", () => {
  /** The runner copied next to a preview-dropped.d holding `hooks`. */
  function world(
    hooks: Record<string, { body: string; executable?: boolean }>
  ) {
    const dir = tempDir();
    const runner = join(dir, "run-preview-dropped-hooks.sh");
    copyFileSync(RUNNER, runner);
    const hookDir = join(dir, "preview-dropped.d");
    mkdirSync(hookDir);
    const log = join(dir, "hooks.log");
    for (const [name, { body, executable = true }] of Object.entries(hooks)) {
      writeFileSync(
        join(hookDir, name),
        `#!/usr/bin/env bash\necho "${name} $*" >>"${log}"\n${body}\n`
      );
      chmodSync(join(hookDir, name), executable ? 0o755 : 0o644);
    }
    const ran = () =>
      existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : [];
    return { runner, ran, env: { PATH: fixturePath(dir) } };
  }

  it("runs every executable .sh hook in name order with the database", () => {
    const { runner, ran, env } = world({
      "50-purge-files.sh": { body: "" },
      "10-first.sh": { body: "" },
      "20-not-executable.sh": { body: "", executable: false },
      "30-notes.txt": { body: "" },
    });

    const result = run(runner, [DB], env);

    expect(result.status).toBe(0);
    expect(ran()).toEqual([`10-first.sh ${DB}`, `50-purge-files.sh ${DB}`]);
  });

  it("runs the other hooks when one fails, then fails naming it", () => {
    const { runner, ran, env } = world({
      "10-broken.sh": { body: "exit 3" },
      "50-purge-files.sh": { body: "" },
    });

    const result = run(runner, [DB], env);

    expect(result.status).toBe(1);
    expect(ran()).toEqual([`10-broken.sh ${DB}`, `50-purge-files.sh ${DB}`]);
    expect(result.stdout + result.stderr).toContain("10-broken.sh");
  });

  it("does nothing, successfully, when there are no hooks", () => {
    const { runner, env } = world({});

    expect(run(runner, [DB], env).status).toBe(0);
  });

  it("needs the dropped database's name", () => {
    const { runner, ran, env } = world({ "50-purge-files.sh": { body: "" } });

    expect(run(runner, [], env).status).toBe(2);
    expect(ran()).toEqual([]);
  });
});

describe("sweep-preview-dbs.sh", () => {
  /**
   * The sweeper copied next to a hook runner and one recording hook, with
   * pg-nonprod listing `rows` and GitHub saying every PR is closed.
   */
  function world(rows: string, hookBody = "") {
    const bin = fakeBin(rows);
    const dir = tempDir();
    const sweeper = join(dir, "sweep-preview-dbs.sh");
    copyFileSync(SWEEPER, sweeper);
    copyFileSync(RUNNER, join(dir, "run-preview-dropped-hooks.sh"));
    mkdirSync(join(dir, "preview-dropped.d"));
    const log = join(dir, "hooks.log");
    writeScript(
      join(dir, "preview-dropped.d", "50-record.sh"),
      `echo "$1" >>"${log}"\n${hookBody}`
    );
    const hooked = () =>
      existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : [];
    return {
      bin,
      dir,
      sweeper,
      hooked,
      env: {
        PATH: bin.path,
        GITHUB_TOKEN: "fixture",
        FOA_SWEEPER_ENV: join(dir, "sweeper.env"),
        FOA_PREVIEW_PURGE_STATE: join(syncedStateDir(), "purge-state"),
      },
    };
  }

  const ROWS = [
    `${DB}\tfoa-preview pr=12`,
    "foa_pr_12_89abcdef\tfoa-preview pr=12",
    "foa_seed\tfoa-preview pr=1",
  ].join("\n");

  it("runs the hooks after each DROP DATABASE, with the dropped name", () => {
    const { bin, sweeper, hooked, env } = world(ROWS);

    const result = run(sweeper, [], env);

    expect(result.status).toBe(0);
    expect(bin.sql()).toContain(`DROP DATABASE IF EXISTS "${DB}"`);
    expect(bin.sql()).toContain('DROP DATABASE IF EXISTS "foa_pr_12_89abcdef"');
    expect(hooked()).toEqual([DB, "foa_pr_12_89abcdef"]);
  });

  it("keeps sweeping when a hook fails, and says so", () => {
    const { bin, sweeper, hooked, env } = world(ROWS, "exit 1");

    const result = run(sweeper, [], env);

    expect(result.status).toBe(0);
    expect(bin.sql()).toContain('DROP DATABASE IF EXISTS "foa_pr_12_89abcdef"');
    expect(hooked()).toEqual([DB, "foa_pr_12_89abcdef"]);
    expect(result.stdout).toMatch(new RegExp(`hook.*failed.*${DB}`));
  });

  it("replays a failed purge after the database is gone and clears it on success", () => {
    const { bin, dir, sweeper, env } = world(`${DB}\tfoa-preview pr=12`);
    const hook = join(dir, "preview-dropped.d", basename(PURGE_HOOK));
    const credentials = join(dir, "preview-files.env");
    copyFileSync(PURGE_HOOK, hook);
    writeFileSync(credentials, "");
    const config = { ...env, FOA_PREVIEW_FILES_ENV: credentials };
    const attempts = () =>
      bin.dockerCalls().filter(([command]) => command === "run");

    expect(run(sweeper, [], { ...config, FAKE_DOCKER_EXIT: "1" }).status).toBe(
      0
    );
    expect(bin.sql()).toContain(`DROP DATABASE IF EXISTS "${DB}"`);
    expect(attempts()).toHaveLength(1);

    expect(run(sweeper, [], { ...config, FAKE_PR_STATE: "open" }).status).toBe(
      0
    );
    expect(run(sweeper, ["--dry-run"], config).status).toBe(0);
    expect(attempts()).toHaveLength(1);

    expect(run(sweeper, [], config).status).toBe(0);
    expect(attempts()).toHaveLength(2);
    expect(attempts()[1]?.at(-1)).toBe(DB);
    expect(run(sweeper, [], config).status).toBe(0);
    expect(attempts()).toHaveLength(2);
  });

  it("waits for all databases sharing the preview prefix to be gone", () => {
    const sibling = "foa_pr_12_89abcdef";
    const { bin, sweeper, hooked, env } = world(
      `${DB}\tfoa-preview pr=12\n${sibling}\tuntagged`
    );

    expect(run(sweeper, [], env).status).toBe(0);
    expect(bin.sql()).toContain(`DROP DATABASE IF EXISTS "${DB}"`);
    expect(bin.sql()).not.toContain(sibling);
    expect(hooked()).toEqual([]);
  });

  it("runs no hook in a dry run", () => {
    const { bin, sweeper, hooked, env } = world(ROWS);

    const result = run(sweeper, ["--dry-run"], env);

    expect(result.status).toBe(0);
    expect(bin.sql()).toBe("");
    expect(hooked()).toEqual([]);
  });
});
