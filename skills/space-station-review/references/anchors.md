# GitHub-native review evidence models

HTML visual anchors, Markdown source ranges, and Live coordinates are deliberately distinct. An HTML visual review thread is a native GitHub file thread. Its first comment contains visible Markdown followed by exactly one strict, inert marker:

```text
<!-- space-station-anchor:v1 BASE64URL_CANONICAL_JSON -->
```

The metadata is validated on every read and contains:

- `page`: full repository path of the reviewed HTML or Markdown file.
- `originCommit`: exact 40-character PR commit SHA where the anchor was created.
- `stableId`: target element ID when one exists.
- `selector`: generated CSS path used as the primary fallback.
- `textFingerprint`: normalized target text used to detect changes and as a final fallback.
- `point.x` / `point.y`: position within the target element, each from 0 to 1.
- `viewport`: viewport where feedback was created; context rather than an absolute position.

The marker has no Space Station signature. GitHub authorship and strict validation establish provenance. Missing, malformed, duplicated, unsupported, oversized, or path-mismatched metadata remains visible ordinary file feedback; it is never partially trusted or executed. Replies never contain anchor metadata.

## Resolution at a selected commit

The preview bridge and agent helper derive position independently for the selected exact SHA:

1. Element with `stableId` — high-confidence attached anchor.
2. Element matching `selector` — attached unless text evidence changed.
3. Element matching `textFingerprint` — uncertain because structure changed.
4. No match — detached.

Once an element resolves, the document point is:

```text
x = element.left + element.width  * point.x
y = element.top  + element.height * point.y
```

Anchor health and coordinates are not persisted. Changing the selected commit recomputes them from that commit's DOM, so a native GitHub thread can remain stable while its visual position changes.

## Markdown source ranges

Rendered Markdown blocks carry bounded inert one-based source start/end attributes. Selection identifies one complete block or a contiguous block range; wrapped browser rows are never presented as independent source lines. For the current PR head, an authoritative bounded diff map may route the range to native GitHub `line`/`side: RIGHT` and optional `start_line`/`start_side: RIGHT` fields. Historical, unchanged, cross-hunk, omitted-patch, or stale ranges require an explicitly confirmed file comment whose visible body starts `Line N:` or `Lines N–M:`. No hidden marker pretends that fallback is inline.

## Live coordinate evidence

Live targets come from exact user-authored PR issue comments carrying `space-station-preview-target:v1`. A Live feedback comment is another top-level PR issue comment with readable text and exactly one `space-station-live-anchor:v1` marker containing the canonical target-comment node ID, normalized HTTPS URL, bounded frame point, and viewport. It contains no page, commit, selector, stable ID, text fingerprint, or source range. Live feedback is standalone and has no Reply or Resolve controls. If the registration is edited or deleted, the feedback comment remains canonical while its target becomes unavailable.

## Role of screenshots

A screenshot is supporting visual context, not canonical anchor data. `snapshot` opens a signed, credential-free exact-SHA preview, resolves each valid visual thread against that DOM, overlays numbered markers, and writes resolved positions to the adjacent JSON manifest.

Use all three sources:

- **GitHub thread:** canonical body, path, author, replies, timestamps, native `isResolved`, and effective Space Station resolution derived from an exact latest signed reply when native state is false.
- **Image and manifest:** composition, marker mapping, selected SHA, and derived placement confidence.
- **Repository source:** implementation context and verified selectors.

A snapshot marker must never override its thread metadata or be reused for another SHA without rebinding.

## Choosing a new visual target

Prefer, in order:

1. A unique ID such as `#pricing-heading`.
2. A narrow semantic selector such as `main > section:nth-of-type(2) > h2`.
3. A generated structural selector only when no stable hook exists.

Choose the smallest element that owns the issue. Target a heading for typography, a container for layout spacing, or an image for imagery. Never invent a selector: verify it in repository source or against the exact-SHA preview DOM.

Point examples:

- Center: `--x 0.5 --y 0.5`
- Top-left: `--x 0.1 --y 0.1`
- Right edge: `--x 0.95 --y 0.5`

Avoid pixel assumptions. The helper records element-local ratios and the bridge recomputes document coordinates after layout, viewport, page, or commit changes.

## Eligibility and permission boundaries

HTML visual feedback uses a native file-level PR review comment, so the full `page` path must be represented by the pull request at the selected eligible commit. An explicitly registered unchanged repository preview may be viewed at an exact commit but does not thereby become eligible for an HTML file review comment. Markdown native ranges additionally require current-head right-side diff eligibility. Live coordinates use a purpose-limited top-level issue comment instead of a file thread. The authenticated GitHub user must have current repository access and the GitHub App must be installed. Native resolution additionally depends on GitHub's permission check.

When GitHub rejects a path, SHA, reply, or resolution mutation, preserve unsent text, reread canonical state, and report the permission or eligibility boundary. Do not create a substitute application record.
