import { bunyan } from '@expo/logger';
import { type Dirent } from 'fs';
import fs from 'fs/promises';
import path from 'path';

export interface ParsedFailureScreenshot {
  flowName: string;
  capturedAtMs: number;
}

// Maestro failure screenshot: `screenshot-[shard-N-]❌-<epochMillis>-(<flowName>).png`.
// The flow name may contain parentheses, so anchor on the `-(` after the epoch and the
// `).png` suffix rather than scanning for parens.
const FAILURE_SCREENSHOT_PATTERN = /^screenshot-(?:shard-\d+-)?❌-(\d+)-\((.+)\)\.png$/u;

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

// Scans every debug dir under testsDirectory whose mtime is recent enough (mtime-based to cover
// the maestro <2.5.0 bug that splits one invocation across two dirs), then keeps only screenshots
// whose own capturedAtMs is at/after capturedSinceMs. Never throws: an unreadable dir is logged
// and skipped so a screenshot harvest can't affect the maestro step outcome.
export async function harvestFailureScreenshotsAsync(args: {
  testsDirectory: string;
  capturedSinceMs: number;
  attemptIndex: number;
  logger: bunyan;
}): Promise<HarvestedScreenshot[]> {
  // Gate dirs by mtime floored to the second, so a dir created within the same second as the
  // attempt start isn't stat'd below the baseline. The exact capturedAtMs gate below is what
  // prevents mis-attributing an earlier attempt's screenshot.
  const dirSinceMtimeMs = Math.floor(args.capturedSinceMs / 1000) * 1000;
  let entries: Dirent[];
  try {
    entries = await fs.readdir(args.testsDirectory, { withFileTypes: true });
  } catch (err: any) {
    args.logger.info({ err }, `Skipping screenshot harvest: cannot read ${args.testsDirectory}.`);
    return [];
  }

  const results: HarvestedScreenshot[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const dirPath = path.join(args.testsDirectory, entry.name);
    let filenames: string[];
    try {
      if ((await fs.stat(dirPath)).mtimeMs < dirSinceMtimeMs) {
        continue;
      }
      filenames = await fs.readdir(dirPath);
    } catch (err: any) {
      args.logger.info({ err }, `Skipping unreadable debug dir ${dirPath}.`);
      continue;
    }
    for (const filename of filenames) {
      const parsed = parseFailureScreenshotFilename(filename);
      // Re-check capture time per file: a dir's mtime can advance after this attempt began (or
      // fall within the floored-second dir baseline), so the dir gate alone would re-attribute an
      // earlier attempt's screenshot to this one.
      if (parsed === null || parsed.capturedAtMs < args.capturedSinceMs) {
        continue;
      }
      results.push({
        fileAbsPath: path.join(dirPath, filename),
        displayName: `Failure Screenshot: ${parsed.flowName} (attempt ${args.attemptIndex + 1})`,
        metadata: {
          kind: 'maestro-test-screenshot',
          flowName: parsed.flowName,
          attemptIndex: args.attemptIndex,
          capturedAtMs: parsed.capturedAtMs,
        },
      });
    }
  }
  return results;
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
