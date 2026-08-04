#!/usr/bin/env bun
import { dirname, extname, resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import {
  appendVisualMetadata,
  normalizeRepositoryPath,
  validateCommitSha,
  validatePullNumber,
  validateRepositoryRef,
  type ReviewThread,
  type VisualAnchorMetadata,
} from "./contracts";

export interface ReviewTarget {
  owner: string;
  repository: string;
  pullNumber: number;
  sha: string;
}

interface ParsedArgs {
  command: string;
  positionals: string[];
  options: Map<string, string | true>;
}

export type GhRunner = (args: string[]) => Promise<string>;

const supportedCommands = new Set([
  "help",
  "--help",
  "inspect",
  "snapshot",
  "preview-url",
  "anchor",
  "add-visual",
]);
const legacyOptions = new Set(["project", "project-id", "revision", "token", "status"]);
const ordinaryCommands = new Set([
  "projects",
  "list",
  "show",
  "reply",
  "add-file",
  "resolve",
  "unresolve",
  "upload",
  "push",
]);

const help = `Space Station GitHub-native visual review helper

Ordinary repository, pull-request, file-thread, reply, and resolution workflows
belong to git and gh. This helper only handles Space Station visual capabilities.

Usage:
  bun review.ts inspect --repo OWNER/REPO --pr NUMBER [--sha SHA] [--path PATH]
  bun review.ts preview-url --repo OWNER/REPO --pr NUMBER [--sha SHA] [--page PAGE]
  bun review.ts snapshot --repo OWNER/REPO --pr NUMBER [--sha SHA] [--page PAGE] [--output PATH]
  bun review.ts anchor --repo OWNER/REPO --pr NUMBER --sha SHA --path PATH --selector CSS --message TEXT
  bun review.ts add-visual --repo OWNER/REPO --pr NUMBER [--sha SHA] --page PAGE --selector CSS --message TEXT

Target defaults are discovered with gh repo view and gh pr view. API requests use
the active token from gh auth token; no Space Station bearer token or project ID
is accepted. Set SPACE_STATION_API_ORIGIN only to override http://localhost:3000.
`;

function parseArgs(argv: string[]): ParsedArgs {
  const [command = "help", ...rest] = argv;
  const positionals: string[] = [];
  const options = new Map<string, string | true>();
  for (let index = 0; index < rest.length; index += 1) {
    const value = rest[index]!;
    if (!value.startsWith("--")) {
      positionals.push(value);
      continue;
    }
    const equals = value.indexOf("=");
    if (equals > 2) {
      options.set(value.slice(2, equals), value.slice(equals + 1));
      continue;
    }
    const name = value.slice(2);
    const next = rest[index + 1];
    if (next && !next.startsWith("--")) {
      options.set(name, next);
      index += 1;
    } else {
      options.set(name, true);
    }
  }
  return { command, positionals, options };
}

function option(args: ParsedArgs, name: string): string | undefined {
  const value = args.options.get(name);
  return typeof value === "string" ? value : undefined;
}

function required(value: string | undefined, label: string): string {
  if (!value) throw new Error(`${label} is required`);
  return value;
}

export function assertNoLegacyArguments(argv: string[]): void {
  const command = argv[0] ?? "help";
  if (ordinaryCommands.has(command)) {
    throw new Error(`${command} is not supported by this helper; use git and gh for ordinary review operations.`);
  }
  for (const value of argv.slice(1)) {
    if (!value.startsWith("--")) continue;
    const name = value.slice(2).split("=", 1)[0]!;
    if (legacyOptions.has(name)) {
      throw new Error(`--${name} is not supported by the GitHub-native helper.`);
    }
  }
}

export function parseReviewTarget(
  repositoryValue: string,
  pullValue: string,
  shaValue: string,
): ReviewTarget {
  const parts = repositoryValue.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error("--repo must use OWNER/REPOSITORY coordinates");
  }
  const repository = validateRepositoryRef({ owner: parts[0], name: parts[1] });
  const pullNumber = validatePullNumber(Number(pullValue));
  const sha = validateCommitSha(shaValue);
  return { owner: repository.owner, repository: repository.name, pullNumber, sha };
}

async function runGh(args: string[]): Promise<string> {
  const process = Bun.spawn(["gh", ...args], { stdout: "pipe", stderr: "pipe" });
  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ]);
  if (exitCode !== 0) {
    throw new Error(stderr.trim() || `gh ${args.join(" ")} failed`);
  }
  return stdout;
}

export async function discoverGitHubToken(run: GhRunner = runGh): Promise<string> {
  let value = "";
  try {
    value = (await run(["auth", "token"])).trim();
  } catch {
    // Emit one stable instruction rather than forwarding credential-adjacent output.
  }
  if (!value) throw new Error("GitHub authentication is required. Run `gh auth login`.");
  return value;
}

async function ghJson<T>(run: GhRunner, args: string[]): Promise<T> {
  const output = await run(args);
  try {
    return JSON.parse(output) as T;
  } catch {
    throw new Error(`gh returned invalid JSON for ${args.slice(0, 2).join(" ")}`);
  }
}

async function resolveTarget(args: ParsedArgs, run: GhRunner = runGh): Promise<ReviewTarget> {
  let repositoryValue = option(args, "repo");
  if (!repositoryValue) {
    const repository = await ghJson<{ nameWithOwner: string }>(run, [
      "repo", "view", "--json", "nameWithOwner",
    ]);
    repositoryValue = repository.nameWithOwner;
  }
  const repositoryParts = repositoryValue.split("/");
  if (repositoryParts.length !== 2) throw new Error("--repo must use OWNER/REPOSITORY coordinates");

  const explicitPull = option(args, "pr");
  const explicitSha = option(args, "sha");
  if (explicitPull && explicitSha) {
    return parseReviewTarget(repositoryValue, explicitPull, explicitSha);
  }
  const prArgs = ["pr", "view"];
  if (explicitPull) prArgs.push(explicitPull);
  prArgs.push("--repo", repositoryValue, "--json", "number,headRefOid");
  const pull = await ghJson<{ number: number; headRefOid: string }>(run, prArgs);
  return parseReviewTarget(
    repositoryValue,
    explicitPull ?? String(pull.number),
    explicitSha ?? pull.headRefOid,
  );
}

function basePath(target: ReviewTarget): string {
  return `/v1/repositories/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repository)}/pulls/${target.pullNumber}`;
}

export function buildPreviewGrantPath(target: ReviewTarget, page?: string): string {
  const preview = `${basePath(target)}/commits/${target.sha}/preview`;
  if (page === undefined) return preview;
  const normalized = normalizeRepositoryPath(page);
  return `${preview}?page=${encodeURIComponent(normalized)}`;
}

export function createVisualCommentBody(body: string, anchor: VisualAnchorMetadata): string {
  return appendVisualMetadata(body, anchor);
}

class ReviewClient {
  constructor(
    private readonly apiOrigin: string,
    private readonly githubToken: string,
  ) {}

  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${this.githubToken}`);
    if (init.body) headers.set("content-type", "application/json");
    const response = await fetch(new URL(path, this.apiOrigin), { ...init, headers });
    const type = response.headers.get("content-type") ?? "";
    const body = type.includes("application/json") ? await response.json() as {
      error?: { message?: string };
    } : null;
    if (!response.ok) throw new Error(body?.error?.message ?? `Space Station API returned HTTP ${response.status}`);
    return body as T;
  }
}

async function previewGrant(
  client: ReviewClient,
  target: ReviewTarget,
  page?: string,
): Promise<{ url: string; page: string }> {
  return client.request<{ url: string; page: string }>(
    buildPreviewGrantPath(target, page),
  );
}

async function openBrowser() {
  try {
    const { chromium } = await import("@playwright/test");
    return await chromium.launch({ headless: true });
  } catch (error) {
    throw new Error(`Could not start Chromium. Run \`bunx playwright install chromium\` first. ${
      error instanceof Error ? error.message : String(error)
    }`);
  }
}

async function visualAnchorFromPage(
  preview: string,
  path: string,
  selector: string,
  point: { x: number; y: number },
): Promise<VisualAnchorMetadata> {
  const browser = await openBrowser();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.goto(preview, { waitUntil: "domcontentloaded" });
    return await page.evaluate(
      ({ selector, path, point }) => {
        const element = document.querySelector(selector);
        if (!element) throw new Error(`No element matches selector: ${selector}`);
        const text = (node: Element) => node.textContent?.trim().replace(/\s+/g, " ").slice(0, 160).toLowerCase() ?? "";
        const cssPath = (node: Element) => {
          if (node.id) return `#${CSS.escape(node.id)}`;
          const parts: string[] = [];
          for (let current: Element | null = node; current && current !== document.documentElement; current = current.parentElement) {
            const peers = current.parentElement
              ? [...current.parentElement.children].filter((item) => item.tagName === current!.tagName)
              : [];
            parts.unshift(current.tagName.toLowerCase() + (peers.length > 1 ? `:nth-of-type(${peers.indexOf(current) + 1})` : ""));
          }
          return parts.join(" > ");
        };
        return {
          page: path,
          originCommit: "", // Set outside the untrusted preview document.
          stableId: element.id || null,
          selector: cssPath(element),
          textFingerprint: text(element),
          point,
          viewport: { width: Math.max(1, Math.round(innerWidth)), height: Math.max(1, Math.round(innerHeight)) },
        };
      },
      { selector, path, point },
    );
  } finally {
    await browser.close();
  }
}

async function addVisual(client: ReviewClient, target: ReviewTarget, args: ParsedArgs) {
  const page = normalizeRepositoryPath(required(option(args, "page"), "--page"));
  const path = page;
  const point = {
    x: Number(option(args, "x") ?? "0.5"),
    y: Number(option(args, "y") ?? "0.5"),
  };
  if (![point.x, point.y].every((value) => Number.isFinite(value) && value >= 0 && value <= 1)) {
    throw new Error("--x and --y must be numbers from 0 to 1 within the selected element.");
  }
  const anchor = await visualAnchorFromPage(
    (await previewGrant(client, target, page)).url,
    path,
    required(option(args, "selector"), "--selector"),
    point,
  );
  anchor.originCommit = target.sha;
  return client.request(`${basePath(target)}/threads`, {
    method: "POST",
    body: JSON.stringify({
      kind: "visual",
      path,
      commitSha: target.sha,
      body: required(option(args, "message"), "--message"),
      anchor,
    }),
  });
}

function resolveInDocument(threads: ReviewThread[]) {
  const normalizedText = (element: Element) => element.textContent?.trim().replace(/\s+/g, " ").slice(0, 160).toLowerCase() ?? "";
  return threads.map((thread, index) => {
    const anchor = thread.anchor!;
    let element: Element | null = anchor.stableId ? document.getElementById(anchor.stableId) : null;
    let health: "attached" | "uncertain" | "detached" = "attached";
    if (!element) {
      try { element = document.querySelector(anchor.selector); } catch { element = null; }
      if (element && anchor.textFingerprint && normalizedText(element) !== anchor.textFingerprint) health = "uncertain";
    }
    if (!element && anchor.textFingerprint) {
      element = [...document.querySelectorAll("body *")].find((candidate) => normalizedText(candidate) === anchor.textFingerprint) ?? null;
      if (element) health = "uncertain";
    }
    if (!element) return { id: thread.id, number: index + 1, found: false, health: "detached" as const };
    const rect = element.getBoundingClientRect();
    const x = scrollX + rect.left + rect.width * anchor.point.x;
    const y = scrollY + rect.top + rect.height * anchor.point.y;
    const marker = document.createElement("div");
    marker.textContent = String(index + 1);
    marker.setAttribute("data-space-station-agent-marker", thread.id);
    Object.assign(marker.style, {
      position: "absolute", zIndex: "2147483647", left: `${x}px`, top: `${y}px`, width: "28px", height: "28px",
      display: "grid", placeItems: "center", border: "2px solid white", borderRadius: "50%", color: "white",
      background: thread.isResolved ? "#35745a" : "#c4432f", boxShadow: "0 3px 10px #0008",
      font: "700 12px system-ui", transform: "translate(-50%, -50%)",
    });
    document.body.append(marker);
    return {
      id: thread.id,
      number: index + 1,
      found: true,
      health,
      documentPoint: { x: Math.round(x), y: Math.round(y) },
      elementBox: {
        x: Math.round(scrollX + rect.left), y: Math.round(scrollY + rect.top),
        width: Math.round(rect.width), height: Math.round(rect.height),
      },
    };
  });
}

async function snapshot(client: ReviewClient, target: ReviewTarget, args: ParsedArgs) {
  const requestedPage = option(args, "page");
  const grant = await previewGrant(
    client,
    target,
    requestedPage ? normalizeRepositoryPath(requestedPage) : undefined,
  );
  const path = grant.page;
  const value = await client.request<{ threads: ReviewThread[] }>(
    `${basePath(target)}/threads?path=${encodeURIComponent(path)}`,
  );
  const visualThreads = value.threads.filter((thread) => thread.anchor !== null);
  const output = resolve(option(args, "output") ?? ".pi/artifacts/space-station-review.png");
  const extension = extname(output);
  const manifest = extension ? `${output.slice(0, -extension.length)}.json` : `${output}.json`;
  await mkdir(dirname(output), { recursive: true });
  const browser = await openBrowser();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.goto(grant.url, { waitUntil: "domcontentloaded" });
    const positions = await page.evaluate(resolveInDocument, visualThreads);
    await page.screenshot({ path: output, fullPage: true });
    const result = {
      repository: `${target.owner}/${target.repository}`,
      pullNumber: target.pullNumber,
      sha: target.sha,
      path,
      screenshot: output,
      comments: visualThreads.map((thread, index) => ({
        number: index + 1,
        id: thread.id,
        isResolved: thread.isResolved,
        anchor: thread.anchor,
        latestComment: thread.comments.at(-1),
        position: positions[index],
      })),
    };
    await Bun.write(manifest, `${JSON.stringify(result, null, 2)}\n`);
    return { screenshot: output, manifest, comments: result.comments };
  } finally {
    await browser.close();
  }
}

const print = (value: unknown) => console.log(JSON.stringify(value, null, 2));

async function main(argv = Bun.argv.slice(2)) {
  assertNoLegacyArguments(argv);
  const args = parseArgs(argv);
  if (!supportedCommands.has(args.command)) throw new Error(`Unknown command: ${args.command}\n\n${help}`);
  if (args.command === "help" || args.command === "--help" || args.options.has("help")) {
    console.log(help);
    return;
  }

  if (args.command === "anchor") {
    const target = parseReviewTarget(
      required(option(args, "repo"), "--repo"),
      required(option(args, "pr"), "--pr"),
      required(option(args, "sha"), "--sha"),
    );
    const anchor: VisualAnchorMetadata = {
      page: normalizeRepositoryPath(required(option(args, "path"), "--path")),
      originCommit: target.sha,
      stableId: option(args, "stable-id") ?? null,
      selector: required(option(args, "selector"), "--selector"),
      textFingerprint: option(args, "text") ?? "",
      point: { x: Number(option(args, "x") ?? "0.5"), y: Number(option(args, "y") ?? "0.5") },
      viewport: { width: Number(option(args, "width") ?? "1280"), height: Number(option(args, "height") ?? "720") },
    };
    print({ anchor, body: createVisualCommentBody(required(option(args, "message"), "--message"), anchor) });
    return;
  }

  const target = await resolveTarget(args);
  const client = new ReviewClient(
    process.env.SPACE_STATION_API_ORIGIN ?? "http://localhost:3000",
    await discoverGitHubToken(),
  );
  if (args.command === "preview-url") {
    print({ ...(await previewGrant(client, target, option(args, "page"))), target });
    return;
  }
  if (args.command === "inspect") {
    const query = option(args, "path") ? `?path=${encodeURIComponent(normalizeRepositoryPath(option(args, "path")!))}` : "";
    const value = await client.request<{ threads: ReviewThread[] }>(`${basePath(target)}/threads${query}`);
    print({ target, visualThreads: value.threads.filter((thread) => thread.anchor !== null) });
    return;
  }
  if (args.command === "snapshot") {
    print(await snapshot(client, target, args));
    return;
  }
  if (args.command === "add-visual") {
    print(await addVisual(client, target, args));
  }
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
