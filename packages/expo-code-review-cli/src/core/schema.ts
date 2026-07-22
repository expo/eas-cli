import { createHash } from 'node:crypto';

import { z } from 'zod';

import { normalizeCode } from './util.js';

/** Severity levels, ordered most→least severe for sorting/rendering. */
export const SEVERITIES = ['critical', 'warning', 'suggestion'] as const;
export type Severity = (typeof SEVERITIES)[number];

/** Sort rank for severities (0 = most severe). Single source of truth. */
export const SEVERITY_RANK: Record<Severity, number> = { critical: 0, warning: 1, suggestion: 2 };

export const CATEGORIES = ['correctness', 'quality', 'security', 'secrets'] as const;
export type Category = (typeof CATEGORIES)[number];

export const DECISIONS = ['approve', 'approve_with_comments', 'request_changes'] as const;
export type Decision = (typeof DECISIONS)[number];

/** A single unit of changed code, produced by a ReviewSource. */
export interface DiffEntry {
  /** Path relative to the repo root, in the new tree. */
  path: string;
  /** Unified-diff patch text for this file. */
  patch: string;
  /** git status letter (A/M/D/R...) when the source can provide it. */
  status?: string;
  /**
   * True when git emitted a binary-diff marker ("Binary files ... differ") for
   * this file instead of a textual patch. Such an entry has no reviewable diff
   * content, so it is filtered as noise rather than handed to an agent.
   */
  binary?: boolean;
}

export interface ReviewMetadata {
  title: string;
  body: string;
  baseRef: string;
  headRef: string;
}

export const FindingSchema = z.object({
  severity: z.enum(SEVERITIES),
  category: z.enum(CATEGORIES),
  file: z.string(),
  line: z.number().int().nullable().optional().default(null),
  title: z.string(),
  rationale: z.string(),
  suggestion: z.string().optional(),
  /**
   * Verbatim snippet of the flagged code, copied from the file. Used to
   * quote-ground the finding: if this text isn't actually present in the file,
   * the finding is treated as hallucinated and dropped.
   */
  evidence: z.string().optional(),
});
export type Finding = z.infer<typeof FindingSchema>;

/** A verifier's verdict on whether a finding is real (adversarial refute pass). */
export const VerdictSchema = z.object({
  verified: z.boolean(),
  reason: z.string().default(''),
});
export type Verdict = z.infer<typeof VerdictSchema>;

export function parseVerdict(text: string): Verdict {
  return VerdictSchema.parse(extractJsonObject(text));
}

/** Shape each sub-reviewer must emit. */
export const ReviewerOutputSchema = z.object({
  findings: z.array(FindingSchema).default([]),
});
export type ReviewerOutput = z.infer<typeof ReviewerOutputSchema>;

/** Mode-agnostic coordinator result; each Reporter decides how to render it. */
export const CoordinatorOutputSchema = z.object({
  decision: z.enum(DECISIONS),
  findings: z.array(FindingSchema).default([]),
  summary: z.string(),
  /**
   * Human-readable notes about reduced coverage (e.g. a review pass that hit its
   * time limit and returned partial findings, or was skipped). Populated by the
   * engine after coordination, not by the model. Reporters surface these so a
   * cut-short review is never presented as complete.
   */
  incomplete: z.array(z.string()).default([]),
});
export type CoordinatorOutput = z.infer<typeof CoordinatorOutputSchema>;

/** A per-PR dismissal ("I don't care about this finding"), keyed by fingerprint. */
export interface DismissalRecord {
  fp: string;
  by?: string;
  reason?: string;
}

/** Minimum normalized evidence length to key a fingerprint on the code (below
 * this we fall back to the title). */
const MIN_FP_EVIDENCE_LEN = 12;

/**
 * Stable identifier for a finding — dedupes across re-reviews and is the key for
 * dismissals. Excludes the line number (which shifts as a PR grows). Keys on the
 * verbatim `evidence` snippet (v2) rather than the LLM-written `title`, which
 * varies run-to-run and would make a dismissal silently lapse. When the flagged
 * code later changes, the hash changes and the dismissal lapses — which is correct
 * (you dismissed that code, not a blank check). Falls back to `title` only when
 * there's too little evidence to key on.
 */
export function fingerprintFinding(finding: Finding): string {
  const evidence = normalizeCode(finding.evidence ?? '');
  const key = evidence.length >= MIN_FP_EVIDENCE_LEN ? evidence : normalizeCode(finding.title);
  const normalized = ['v2', finding.file, finding.category, key].join('|');
  return createHash('sha1').update(normalized).digest('hex').slice(0, 12);
}

/**
 * Extract the JSON payload from an LLM response. Prefers the last fenced
 * ```json block; falls back to the outermost {...} span. Throws if neither
 * parses.
 */
export function extractJsonObject(text: string): unknown {
  const fenceMatches = [...text.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/gi)];
  const candidates: string[] = [];
  if (fenceMatches.length > 0) {
    candidates.push(fenceMatches[fenceMatches.length - 1]![1]!.trim());
  }
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    candidates.push(text.slice(firstBrace, lastBrace + 1));
  }

  let lastError: unknown;
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(
    `Could not extract JSON from model response: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`
  );
}

/** The router's choice of which agent ids to run. */
export const RouteOutputSchema = z.object({
  agents: z.array(z.string()).default([]),
});
export type RouteOutput = z.infer<typeof RouteOutputSchema>;

export function parseRouteOutput(text: string): RouteOutput {
  return RouteOutputSchema.parse(extractJsonObject(text));
}

export function parseReviewerOutput(text: string): ReviewerOutput {
  return ReviewerOutputSchema.parse(extractJsonObject(text));
}

export function parseCoordinatorOutput(text: string): CoordinatorOutput {
  return CoordinatorOutputSchema.parse(extractJsonObject(text));
}
