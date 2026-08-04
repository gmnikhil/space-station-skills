import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const skill = resolve(import.meta.dir, "../skills/install-space-station");
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function run(script: string, args: string[]) {
  const child = Bun.spawn([join(skill, "scripts", script), ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { stdout, stderr, exitCode };
}

async function replace(file: string, key: string, value: string) {
  const contents = await readFile(file, "utf8");
  const next = contents.replace(new RegExp(`^${key}=.*$`, "m"), `${key}=${value}`);
  await writeFile(file, next, { mode: 0o600 });
  await chmod(file, 0o600);
}

describe("standalone installer", () => {
  test("bootstraps private configuration and refuses overwrite", async () => {
    const root = await mkdtemp(join(tmpdir(), "space-station-install-"));
    roots.push(root);
    const result = await run("bootstrap.sh", [root, "1.0.0"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).not.toContain("AUTH_SESSION_KEYS=");
    expect(result.stdout).not.toContain("GITHUB_WEBHOOK_SECRET=");
    expect((await stat(join(root, ".env"))).mode & 0o777).toBe(0o600);
    expect(await Bun.file(join(root, "compose.production.yml")).exists()).toBe(true);

    const env = await readFile(join(root, ".env"), "utf8");
    expect(env).toContain("SPACE_STATION_VERSION=1.0.0");
    expect(env).not.toContain("AUTH_SESSION_KEYS=\n");
    expect(env).not.toContain("PREVIEW_SIGNING_SECRET=\n");
    expect(env).not.toContain("GITHUB_WEBHOOK_SECRET=\n");

    const second = await run("bootstrap.sh", [root, "1.0.0"]);
    expect(second.exitCode).toBe(2);
    expect(second.stderr).toContain("preserved");
    expect(await readFile(join(root, ".env"), "utf8")).toBe(env);
  });

  test("reports names only, validates complete fields, and updates only version", async () => {
    const root = await mkdtemp(join(tmpdir(), "space-station-install-"));
    roots.push(root);
    expect((await run("bootstrap.sh", [root, "1.0.0"])).exitCode).toBe(0);

    const incomplete = await run("check-config.sh", [root]);
    expect(incomplete.exitCode).toBe(1);
    expect(incomplete.stderr).toContain("GITHUB_APP_ID");
    expect(incomplete.stderr).not.toContain("local-v1");

    const envFile = join(root, ".env");
    await replace(envFile, "GITHUB_APP_ID", "1");
    await replace(envFile, "GITHUB_PRIVATE_KEY", "fixture-key-material");
    await replace(envFile, "GITHUB_CLIENT_ID", "fixture-client");
    await replace(envFile, "GITHUB_CLIENT_SECRET", "fixture-client-secret");
    const before = await readFile(envFile, "utf8");

    const complete = await run("check-config.sh", [root]);
    expect(complete.exitCode).toBe(0);
    const updated = await run("set-version.sh", [root, "1.2.3"]);
    expect(updated.exitCode).toBe(0);
    const after = await readFile(envFile, "utf8");
    expect(after).toBe(before.replace("SPACE_STATION_VERSION=1.0.0", "SPACE_STATION_VERSION=1.2.3"));
  });
});
