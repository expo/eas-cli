import { z } from 'zod';

/** Severity levels, ordered most→least severe for sorting/rendering. */
export const SEVERITIES = ['critical', 'warning', 'suggestion'] as const;
export type Severity = (typeof SEVERITIES)[number];

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
});
export type Finding = z.infer<typeof FindingSchema>;

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
});
export type CoordinatorOutput = z.infer<typeof CoordinatorOutputSchema>;

/**
 * Extract the JSON payload from an LLM response. Prefers the last fenced
 * ```json block; falls back to the outermost {...} span. Throws if neither
 * parses.
 */
export function extractJsonObject(text: string): unknown {
  const fenceMatches = [...text.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/gi)];
  const candidates: string[] = [];
  if (fenceMatches.length > 0) {
    // Prefer the last fenced block — models sometimes echo the contract first.
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

export function parseReviewerOutput(text: string): ReviewerOutput {
  return ReviewerOutputSchema.parse(extractJsonObject(text));
}

export function parseCoordinatorOutput(text: string): CoordinatorOutput {
  return CoordinatorOutputSchema.parse(extractJsonObject(text));
}
