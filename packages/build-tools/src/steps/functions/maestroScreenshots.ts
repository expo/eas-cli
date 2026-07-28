import { bunyan } from '@expo/logger';
import { type Dirent } from 'fs';
import fs from 'fs/promises';
import path from 'path';

export interface ParsedFailureScreenshot {
  flowName: string;
  capturedAtMs: number;
}

// pre-v2.7.0 (Maestro <= 2.6.x): failure screenshots are flat files named
// `screenshot-[shard-N-]❌-<epochMillis>-(<flowName>).png` directly in the session dir.
// The flow name may contain parentheses, so anchor on the `-(` after the epoch and the
// `).png` suffix rather than scanning for parens. Remove this path once the build fleet is
// entirely on Maestro >= 2.7.0.
const FAILURE_SCREENSHOT_PATTERN = /^screenshot-(?:shard-\d+-)?❌-(\d+)-\((.+)\)\.png$/u;

// Maestro >= 2.7.0 bundle layout. Each flow gets its own dir under the session dir, with step
// screenshots under `screenshots/` named `step-<NNN>-<slug>.png` (NNN is a 1-based, zero-padded
// monotonic step sequence). Under the CLI (no `--analyze`) only failed/warned steps produce one.
const STEP_SCREENSHOTS_DIRNAME = 'screenshots';
const STEP_SCREENSHOT_PATTERN = /^step-(\d+)(?:-.*)?\.png$/;

// pre-v2.7.0: parses the legacy flat failure-screenshot filename.
export function parseFailureScreenshotFilename(filename: string): ParsedFailureScreenshot | null {
  const match = filename.match(FAILURE_SCREENSHOT_PATTERN);
  if (!match) {
    return null;
  }
  const capturedAtMs = Number(match[1]);
  if (!Number.isFinite(capturedAtMs)) {
    return null;
  }
  return {
    flowName: match[2],
    capturedAtMs,
  };
}

export interface HarvestedScreenshot {
  fileAbsPath: string;
  displayName: string; // `Failure Screenshot: <flowName> (attempt <n>)`
  metadata: {
    kind: 'maestro-test-screenshot';
    // The Maestro flow name straight from the filename (already '/'->'_' substituted by
    // Maestro). The website matches this against `attempt.name` (normalized the same way).
    flowName: string;
    attemptIndex: number;
    capturedAtMs: number;
  };
}

// Harvests one attempt's failure screenshots from the maestro debug output. Walks each session
// dir under testsDirectory whose mtime is recent enough (mtime-based to also cover the maestro
// <2.5.0 bug that splits one invocation across two dirs). Within a session dir, a child is either
// a flat pre-v2.7.0 screenshot file or a Maestro >= 2.7.0 per-flow bundle dir — the single
// structural seam below. Never throws: an unreadable dir/file is logged and skipped so a
// screenshot harvest can't affect the maestro step outcome.
export async function harvestFailureScreenshotsAsync(args: {
  testsDirectory: string;
  capturedSinceMs: number;
  attemptIndex: number;
  // Flow names the JUnit report marks failed for THIS attempt (raw; normalized here). A v2.7.0
  // bundle dir carries no failure marker, so this is what tells a failed flow's bundle apart from
  // a passing flow that merely left a warned-step screenshot. Unused by the legacy path.
  failedFlowNames: ReadonlySet<string>;
  logger: bunyan;
}): Promise<HarvestedScreenshot[]> {
  // Gate dirs by mtime floored to the second, so a dir created within the same second as the
  // attempt start isn't stat'd below the baseline. The exact capturedAtMs gate per file is what
  // prevents mis-attributing an earlier attempt's screenshot.
  const dirSinceMtimeMs = Math.floor(args.capturedSinceMs / 1000) * 1000;
  // Bundle dir names already have '/' -> '_'; normalize the JUnit names the same way to match.
  const normalizedFailedFlowNames = new Set([...args.failedFlowNames].map(normalizeFlowName));

  let sessionEntries: Dirent[];
  try {
    sessionEntries = await fs.readdir(args.testsDirectory, { withFileTypes: true });
  } catch (err: any) {
    args.logger.info({ err }, `Skipping screenshot harvest: cannot read ${args.testsDirectory}.`);
    return [];
  }

  const legacyShots: HarvestedScreenshot[] = [];
  const bundleShots: HarvestedScreenshot[] = [];
  for (const sessionEntry of sessionEntries) {
    if (!sessionEntry.isDirectory()) {
      continue;
    }
    const sessionDir = path.join(args.testsDirectory, sessionEntry.name);
    let children: Dirent[];
    try {
      if ((await fs.stat(sessionDir)).mtimeMs < dirSinceMtimeMs) {
        continue;
      }
      children = await fs.readdir(sessionDir, { withFileTypes: true });
    } catch (err: any) {
      args.logger.info({ err }, `Skipping unreadable debug dir ${sessionDir}.`);
      continue;
    }
    for (const child of children) {
      if (child.isDirectory()) {
        // Maestro >= 2.7.0: a per-flow bundle dir.
        const shot = await harvestFromBundleAsync({
          bundleDir: path.join(sessionDir, child.name),
          bundleName: child.name,
          normalizedFailedFlowNames,
          capturedSinceMs: args.capturedSinceMs,
          attemptIndex: args.attemptIndex,
          logger: args.logger,
        });
        if (shot !== null) {
          bundleShots.push(shot);
        }
      } else {
        // pre-v2.7.0: a flat failure screenshot file in the session dir.
        const shot = harvestLegacyFlatShot({
          fileName: child.name,
          sessionDir,
          capturedSinceMs: args.capturedSinceMs,
          attemptIndex: args.attemptIndex,
        });
        if (shot !== null) {
          legacyShots.push(shot);
        }
      }
    }
  }
  // The website shows one screenshot per (flow, attempt). Two v2.7.0 bundle dirs can resolve to
  // the same flow — a collision dir (`<flow>-2`) or a duplicate flow name — so keep the latest.
  // Legacy shots need no dedupe: a flat filename is emitted once per failed flow, so there is no
  // `<flow>-2` collision to collapse (and deduping them would change historical behavior).
  return [...legacyShots, ...dedupeBundleShotsByFlowName(bundleShots)];
}

// Maestro >= 2.7.0: resolve a bundle dir to its owning failed flow and return that flow's failure
// screenshot — the highest-numbered step in `screenshots/`. A required failure halts the flow, so
// the failed step is normally the last (highest-numbered) captured step; earlier warned steps have
// lower numbers. Best-effort limitation: without reading Maestro's per-command JSON we can't tell a
// failed-step frame from a warned-step frame, so if the failing command captured nothing (e.g. a
// non-visible command like runScript) but an earlier optional step warned, we return that warned
// frame instead. Returns null when the bundle isn't a failed flow, its name is ambiguous, or it has
// no usable step screenshot. Never throws.
async function harvestFromBundleAsync(args: {
  bundleDir: string;
  bundleName: string;
  normalizedFailedFlowNames: ReadonlySet<string>;
  capturedSinceMs: number;
  attemptIndex: number;
  logger: bunyan;
}): Promise<HarvestedScreenshot | null> {
  const flowName = resolveBundleFlowName(args.bundleName, args.normalizedFailedFlowNames);
  if (flowName === null) {
    return null;
  }
  const screenshotsDir = path.join(args.bundleDir, STEP_SCREENSHOTS_DIRNAME);
  let filenames: string[];
  try {
    filenames = await fs.readdir(screenshotsDir);
  } catch {
    // No screenshots/ dir — e.g. the flow failed on a non-visible command, which captures none.
    return null;
  }

  let best: { fileAbsPath: string; stepIndex: number; capturedAtMs: number } | null = null;
  for (const filename of filenames) {
    const match = filename.match(STEP_SCREENSHOT_PATTERN);
    if (match === null) {
      continue; // final.png and any non-step file
    }
    const stepIndex = Number(match[1]);
    const fileAbsPath = path.join(screenshotsDir, filename);
    let capturedAtMs: number;
    try {
      capturedAtMs = Math.round((await fs.stat(fileAbsPath)).mtimeMs);
    } catch (err: any) {
      args.logger.info({ err }, `Skipping unreadable screenshot ${fileAbsPath}.`);
      continue;
    }
    if (capturedAtMs < args.capturedSinceMs) {
      continue; // a prior attempt's frame (bundle dir touched later than this attempt started)
    }
    if (best === null || stepIndex > best.stepIndex) {
      best = { fileAbsPath, stepIndex, capturedAtMs };
    }
  }
  if (best === null) {
    return null;
  }
  return {
    fileAbsPath: best.fileAbsPath,
    displayName: `Failure Screenshot: ${flowName} (attempt ${args.attemptIndex + 1})`,
    metadata: {
      kind: 'maestro-test-screenshot',
      flowName,
      attemptIndex: args.attemptIndex,
      capturedAtMs: best.capturedAtMs,
    },
  };
}

// Maestro names a bundle dir `<cleanFlow>` optionally + `-shard-<n>` (sharded) + `-<n>` (name
// collision), where cleanFlow is the flow name with '/' -> '_'. Those suffixes share a namespace
// with legitimate flow names, so we can't strip blindly (a flow may be named `x-shard-1` or `x-2`).
// Enumerate the ways the dir name could peel back to a flow name, keep those that match a failed
// flow, and use the result only if exactly one fits — otherwise skip rather than guess.
function resolveBundleFlowName(
  bundleName: string,
  normalizedFailedFlowNames: ReadonlySet<string>
): string | null {
  const withoutCollision = bundleName.replace(/-\d+$/, '');
  const preimages = [
    bundleName,
    withoutCollision,
    withoutCollision.replace(/-shard-\d+$/, ''),
    bundleName.replace(/-shard-\d+$/, ''),
  ];
  const matches = new Set(preimages.filter(name => normalizedFailedFlowNames.has(name)));
  return matches.size === 1 ? [...matches][0] : null;
}

// Keep one screenshot per flow name (attemptIndex is constant within a harvest call), preferring
// the latest capture when two bundles resolve to the same flow.
function dedupeBundleShotsByFlowName(shots: HarvestedScreenshot[]): HarvestedScreenshot[] {
  const byFlowName = new Map<string, HarvestedScreenshot>();
  for (const shot of shots) {
    const existing = byFlowName.get(shot.metadata.flowName);
    if (existing === undefined || shot.metadata.capturedAtMs > existing.metadata.capturedAtMs) {
      byFlowName.set(shot.metadata.flowName, shot);
    }
  }
  return [...byFlowName.values()];
}

// pre-v2.7.0 (Maestro <= 2.6.x) reader: a flat `screenshot-...❌...png` file whose name carries the
// flow name and capture epoch.
function harvestLegacyFlatShot(args: {
  fileName: string;
  sessionDir: string;
  capturedSinceMs: number;
  attemptIndex: number;
}): HarvestedScreenshot | null {
  const parsed = parseFailureScreenshotFilename(args.fileName);
  // Re-check capture time per file — a dir's mtime can advance after this attempt began, so the dir
  // gate alone would re-attribute an earlier attempt's screenshot to this one.
  if (parsed === null || parsed.capturedAtMs < args.capturedSinceMs) {
    return null;
  }
  return {
    fileAbsPath: path.join(args.sessionDir, args.fileName),
    displayName: `Failure Screenshot: ${parsed.flowName} (attempt ${args.attemptIndex + 1})`,
    metadata: {
      kind: 'maestro-test-screenshot',
      flowName: parsed.flowName,
      attemptIndex: args.attemptIndex,
      capturedAtMs: parsed.capturedAtMs,
    },
  };
}

// Maestro substitutes '/' -> '_' in screenshot filenames (so HarvestedScreenshot.flowName
// is already in that form) but keeps '/' in the JUnit testcase name. Normalize the JUnit
// name the same way before comparing — matching the website's own normalization.
function normalizeFlowName(name: string): string {
  return name.replace(/\//g, '_');
}

// A flow is a "pure failure" when it failed and never passed across all attempts. The website
// surfaces only the final screenshot for such a flow, so keeping its earlier attempts would
// spend the per-job artifact budget on screenshots that are never shown — we keep only the final
// one (selectFailureScreenshots). A flow that passed at least once (flaky / fail-pass-fail) is
// NOT pure: each of its failed attempts is a distinct failure and is kept.
export function computePureFailureFlowNames(
  testCases: readonly { name: string; status: 'passed' | 'failed' }[]
): Set<string> {
  const passed = new Set<string>();
  const failed = new Set<string>();
  for (const testCase of testCases) {
    const flowName = normalizeFlowName(testCase.name);
    if (testCase.status === 'passed') {
      passed.add(flowName);
    } else {
      failed.add(flowName);
    }
  }
  const pure = new Set<string>();
  for (const flowName of failed) {
    if (!passed.has(flowName)) {
      pure.add(flowName);
    }
  }
  return pure;
}

// Keep every harvested screenshot for flaky/mixed flows; for pure-failure flows keep only
// the final (highest attemptIndex) screenshot.
export function selectFailureScreenshots(
  harvested: readonly HarvestedScreenshot[],
  pureFailureFlowNames: ReadonlySet<string>
): HarvestedScreenshot[] {
  const finalAttemptByPureFlow = new Map<string, number>();
  for (const shot of harvested) {
    if (!pureFailureFlowNames.has(shot.metadata.flowName)) {
      continue;
    }
    const finalAttempt = finalAttemptByPureFlow.get(shot.metadata.flowName);
    if (finalAttempt === undefined || shot.metadata.attemptIndex > finalAttempt) {
      finalAttemptByPureFlow.set(shot.metadata.flowName, shot.metadata.attemptIndex);
    }
  }
  return harvested.filter(shot => {
    const finalAttempt = finalAttemptByPureFlow.get(shot.metadata.flowName);
    return finalAttempt === undefined || shot.metadata.attemptIndex === finalAttempt;
  });
}
