import { readFile } from 'node:fs/promises';
import path from 'node:path';

import type { Finding } from './schema.js';
import { parseVerdict } from './schema.js';
import { addTokenUsage, promptAndParse, VERIFIER_AGENT } from './opencode.js';
import type { OpencodeHandle, TokenUsage } from './opencode.js';
import { buildVerifierSystem, buildVerifierTask } from './prompts.js';
import { errorMessage } from './util.js';

// Verification runs after coordination (a serial tail step); keep it short. It
// runs criticals in parallel, so this bounds the added latency regardless of count.
const VERIFY_TIMEOUT_MS = 3 * 60 * 1000;
// Evidence shorter than this (normalized) is too weak to conclude "hallucinated".
const MIN_EVIDENCE_LEN = 12;

export interface VerificationResult {
  kept: Finding[];
  dropped: Array<{ finding: Finding; reason: string }>;
  cost: number;
  tokens: TokenUsage;
}

/** Collapse whitespace + lowercase, for tolerant substring matching. */
function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Deterministic quote-grounding: does the finding's `evidence` snippet actually
 * appear in the file? Returns `unknown` (don't judge) when there's too little
 * evidence or the file can't be read (e.g. a base-ref checkout that lacks a
 * PR-added file), so we never drop a finding we couldn't actually check.
 */
async function evidencePresence(
  finding: Finding,
  cwd: string
): Promise<'present' | 'absent' | 'unknown'> {
  const evidence = normalize(finding.evidence ?? '');
  if (evidence.length < MIN_EVIDENCE_LEN) {
    return 'unknown';
  }
  let content: string;
  try {
    content = await readFile(path.resolve(cwd, finding.file), 'utf8');
  } catch {
    return 'unknown';
  }
  return normalize(content).includes(evidence) ? 'present' : 'absent';
}

/**
 * Guard against hallucinated findings before they're surfaced:
 *  1. Quote-grounding (deterministic, all findings): drop any whose quoted
 *     `evidence` is definitively not in the file.
 *  2. Adversarial verify (LLM, criticals only): a skeptical pass re-reads the real
 *     file and must confirm the critical is genuine; refuted criticals are dropped.
 * Fails OPEN — if a verify call itself errors, the critical is kept (better a
 * possible false positive than hiding a real critical on an infra hiccup).
 */
export async function verifyFindings(
  handle: OpencodeHandle,
  findings: Finding[],
  cwd: string,
  onProgress?: (message: string) => void
): Promise<VerificationResult> {
  const dropped: Array<{ finding: Finding; reason: string }> = [];
  let cost = 0;
  const tokens: TokenUsage = {};

  // Phase 1 — quote-grounding for every finding.
  const checked = await Promise.all(
    findings.map(async finding => ({ finding, presence: await evidencePresence(finding, cwd) }))
  );
  const survivors: Finding[] = [];
  for (const { finding, presence } of checked) {
    if (presence === 'absent') {
      dropped.push({ finding, reason: 'quoted code not found in file (likely hallucinated)' });
      onProgress?.(
        `  verify: dropped ${finding.severity} "${finding.title}" — quoted code not in ${finding.file}`
      );
    } else {
      survivors.push(finding);
    }
  }

  // Phase 2 — adversarial verify for surviving criticals, in parallel.
  const refuted = new Set<Finding>();
  await Promise.all(
    survivors
      .filter(finding => finding.severity === 'critical')
      .map(async (finding, index) => {
        try {
          const { value, cost: verifyCost, tokens: verifyTokens } = await promptAndParse(
            handle,
            {
              agent: VERIFIER_AGENT,
              system: buildVerifierSystem(),
              text: buildVerifierTask(finding),
              title: `verify-${index}`,
              maxWaitMs: VERIFY_TIMEOUT_MS,
              finalizeOnTimeout: true,
            },
            parseVerdict
          );
          cost += verifyCost;
          addTokenUsage(tokens, verifyTokens);
          if (!value.verified) {
            refuted.add(finding);
            onProgress?.(
              `  verify: dropped critical "${finding.title}" — ${value.reason || 'refuted by verifier'}`
            );
          }
        } catch (error) {
          // Fail open: keep the critical if verification itself failed.
          onProgress?.(
            `  verify: could not verify critical "${finding.title}" (${errorMessage(error)}); keeping it`
          );
        }
      })
  );

  const kept: Finding[] = [];
  for (const finding of survivors) {
    if (refuted.has(finding)) {
      dropped.push({ finding, reason: 'refuted by verifier' });
    } else {
      kept.push(finding);
    }
  }

  return { kept, dropped, cost, tokens };
}
