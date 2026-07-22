import { readFile } from 'node:fs/promises';
import path from 'node:path';

import type { Finding } from './schema.js';

const DIRECTIVE = 'expo-code-review-ignore';

export interface SuppressionResult {
  kept: Finding[];
  suppressed: Finding[];
}

/**
 * Deterministic backstop for the inline `expo-code-review-ignore` directive (which
 * was previously prompt-only, i.e. honored only if the model chose to). Drops a
 * finding when its flagged line — or the line just above it — carries the
 * directive.
 *
 * Carve-out: NEVER suppress a `critical` or `secrets` finding this way. An author
 * could otherwise hide a real vulnerability in their own PR by adding one comment
 * line; those always surface, consistent with the shared-prompt invariant.
 */
export async function applyInlineIgnores(
  findings: Finding[],
  cwd: string,
  onProgress?: (message: string) => void
): Promise<SuppressionResult> {
  const kept: Finding[] = [];
  const suppressed: Finding[] = [];
  const cache = new Map<string, string[] | null>();

  for (const finding of findings) {
    if (!(await hasDirectiveNear(finding, cwd, cache))) {
      kept.push(finding);
      continue;
    }
    if (finding.severity === 'critical' || finding.category === 'secrets') {
      kept.push(finding);
      onProgress?.(
        `  inline-ignore present but NOT honored for ${finding.severity}/${finding.category} "${finding.title}"`
      );
    } else {
      suppressed.push(finding);
      onProgress?.(`  suppressed "${finding.title}" via ${DIRECTIVE}`);
    }
  }
  return { kept, suppressed };
}

async function hasDirectiveNear(
  finding: Finding,
  cwd: string,
  cache: Map<string, string[] | null>
): Promise<boolean> {
  if (finding.line == null) {
    return false;
  }
  const lines = await readLines(finding.file, cwd, cache);
  if (!lines) {
    return false;
  }
  const idx = finding.line - 1; // 1-based → 0-based
  const flagged = lines[idx] ?? '';
  const above = idx > 0 ? (lines[idx - 1] ?? '') : '';
  return flagged.includes(DIRECTIVE) || above.includes(DIRECTIVE);
}

async function readLines(
  file: string,
  cwd: string,
  cache: Map<string, string[] | null>
): Promise<string[] | null> {
  if (cache.has(file)) {
    return cache.get(file)!;
  }
  let lines: string[] | null;
  try {
    lines = (await readFile(path.resolve(cwd, file), 'utf8')).split('\n');
  } catch {
    lines = null;
  }
  cache.set(file, lines);
  return lines;
}
