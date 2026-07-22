import { z } from 'zod';

export const ReviewConfigSchema = z.object({
  /** Default model for every agent + the coordinator. Override per-agent via
   * frontmatter in the agent's markdown, or globally via REVIEWER_MODEL. */
  model: z.string().default('anthropic/claude-sonnet-4-5'),
  policy: z
    .object({
      includeSuggestions: z.boolean().default(false),
      maxFindings: z.number().int().positive().optional(),
    })
    .default({ includeSuggestions: false }),
  chunk: z
    .object({
      // Chunking is bounded by changed lines (added + removed), not file count —
      // "how much code the model must actually reason about" is what dilutes
      // attention, and 20 one-line tweaks are nothing like 3 files of 800 lines.
      //
      // A diff whose total changed lines fit in one chunk is reviewed in a single
      // full-context pass (no chunking, no cross-cutting overhead). Larger diffs
      // split into focused chunks, plus a cross-cutting pass for diff-spanning
      // issues.
      //
      // Why 1000: it's a heuristic, not a measured optimum. Most real PRs change
      // well under ~1000 lines, so they get a single full-context pass and skip
      // chunking entirely; only genuinely large PRs split. It sits comfortably
      // below the ~2k-line range where we saw a single pass start to dilute and
      // miss issues — with headroom, since the hardened prompts recall well even
      // on big diffs. Coupled to `model`.
      //
      // When to tweak:
      //  - LOWER it if the reviewer misses issues on larger PRs, or if you switch
      //    to a cheaper/smaller/faster model (those dilute sooner).
      //  - RAISE it to cut cost/latency (fewer chunks, cross-cutting triggers less
      //    often) when the model handles big diffs well, when you move to a
      //    stronger model, or when PRs are mostly mechanical/low-density changes.
      //  - Re-tune from real-PR data (false-negative rate vs threshold), not guesses.
      maxChangedLines: z.number().int().positive().default(1000),
      // Secondary guard so a chunk isn't an absurd number of tiny-diff files.
      maxFiles: z.number().int().positive().default(20),
      // Max concurrent reviewer calls across all agents/chunks.
      concurrency: z.number().int().positive().default(4),
    })
    .default({ maxChangedLines: 1000, maxFiles: 20, concurrency: 4 }),
  noise: z
    .object({
      additionalIgnores: z.array(z.string()).default([]),
      additionalMarkers: z.array(z.string()).default([]),
    })
    .default({ additionalIgnores: [], additionalMarkers: [] }),
  breakGlass: z
    .object({ marker: z.string().default('/skip-review') })
    .default({ marker: '/skip-review' }),
  commentTag: z.string().default('expo-ai-code-reviewer'),
  auth: z
    .object({
      // "api-key": the token env is sent as the provider's API key (x-api-key).
      // "oauth": the token env is a Claude Pro/Max style OAuth token, injected
      // into an isolated OpenCode auth.json so it's sent as a Bearer token.
      mode: z.enum(['api-key', 'oauth']).default('api-key'),
      provider: z.string().default('anthropic'),
      /** Env var holding the key/token. */
      tokenEnv: z.string().optional(),
    })
    .default({ mode: 'api-key', provider: 'anthropic' }),
});
export type RawReviewConfig = z.infer<typeof ReviewConfigSchema>;

/** A single agent after prompt files are read and models are resolved. */
export interface LoadedAgent {
  id: string;
  /** One-line summary from frontmatter, used by the router to pick agents. */
  description: string;
  /** Frontmatter `alwaysRun: true` — router always includes it (e.g. security). */
  alwaysRun: boolean;
  model: string;
  temperature: number;
  tools: Record<string, boolean>;
  /** Role prompt text (not including the shared prompt). */
  promptText: string;
}

/** Fully-resolved config: prompt files read, models resolved, defaults applied. */
export interface LoadedConfig {
  configDir: string;
  sharedPromptText: string;
  agents: LoadedAgent[];
  coordinator: {
    model: string;
    temperature: number;
    promptText: string;
  };
  policy: {
    includeSuggestions: boolean;
    maxFindings?: number;
  };
  chunk: {
    maxChangedLines: number;
    maxFiles: number;
    concurrency: number;
  };
  noise: {
    additionalIgnores: string[];
    additionalMarkers: string[];
  };
  breakGlassMarker: string;
  commentTag: string;
  auth: {
    mode: 'api-key' | 'oauth';
    provider: string;
    tokenEnv?: string;
  };
}
