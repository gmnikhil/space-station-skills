import { describe, expect, test } from "bun:test";
import { parseVisualCommentBody } from "../skills/space-station-review/scripts/contracts";
import {
  assertNoLegacyArguments,
  buildPreviewGrantPath,
  createVisualCommentBody,
  discoverGitHubToken,
  parseReviewTarget,
} from "../skills/space-station-review/scripts/review";

const sha = "2222222222222222222222222222222222222222";

describe("standalone Space Station review helper", () => {
  test("parses explicit repository, PR, and SHA coordinates", () => {
    expect(parseReviewTarget("orbit/atelier-site", "42", sha)).toEqual({
      owner: "orbit",
      repository: "atelier-site",
      pullNumber: 42,
      sha,
    });
    expect(() => parseReviewTarget("project-id", "42", sha)).toThrow(/OWNER\/REPOSITORY/);
    expect(() => parseReviewTarget("orbit/atelier-site", "0", sha)).toThrow();
    expect(() => parseReviewTarget("orbit/atelier-site", "42", "head")).toThrow();
  });

  test("discovers user authorization without persisting credentials", async () => {
    const calls: string[][] = [];
    const token = await discoverGitHubToken(async (args) => {
      calls.push(args);
      return "gh-user-token\n";
    });
    expect(token).toBe("gh-user-token");
    expect(calls).toEqual([["auth", "token"]]);
    await expect(discoverGitHubToken(async () => "")).rejects.toThrow(/gh auth login/);
  });

  test("outputs one canonical visual marker", () => {
    const output = createVisualCommentBody("Tighten this spacing", {
      page: "site/index.html",
      originCommit: sha,
      stableId: "hero",
      selector: "#hero",
      textFingerprint: "launch faster",
      point: { x: 0.5, y: 0.25 },
      viewport: { width: 1280, height: 720 },
    });
    const parsed = parseVisualCommentBody(output);
    expect(parsed.visibleBody).toBe("Tighten this spacing");
    expect(parsed.anchor?.originCommit).toBe(sha);
    expect(output.match(/space-station-anchor:v1/g)).toHaveLength(1);
  });

  test("builds an exact-SHA preview request without credentials", () => {
    const path = buildPreviewGrantPath(
      { owner: "orbit", repository: "atelier-site", pullNumber: 42, sha },
      "pages/about.html",
    );
    expect(path).toBe(
      `/v1/repositories/orbit/atelier-site/pulls/42/commits/${sha}/preview?page=pages%2Fabout.html`,
    );
    expect(path).not.toContain("token");
  });

  test("refuses legacy commands and arguments", () => {
    for (const argv of [
      ["snapshot", "--project", "uuid"],
      ["snapshot", "--revision", "uuid"],
      ["snapshot", "--token", "secret"],
      ["list", "--status", "addressed"],
      ["upload", "--repo", "orbit/atelier-site"],
    ]) {
      expect(() => assertNoLegacyArguments(argv)).toThrow(/not supported|git and gh/i);
    }
  });
});
