import { z } from 'zod';

/** One reviewer agent, as declared in a repo's config.jsonc. */
export const AgentConfigSchema = z.object({
  id: z.string(),
  /** Path to the role prompt, relative to the config dir. */
  prompt: z.string(),
  /** Overrides the top-level default model for this agent. */
  model: z.string().optional(),
  /** OpenCode tool toggles; merged over the read-only defaults. */
  tools: z.record(z.string(), z.boolean()).optional(),
  temperature: z.number().optional(),
});
export type AgentConfig = z.infer<typeof AgentConfigSchema>;

export const ReviewConfigSchema = z.object({
  /** Default model for every agent (override per-agent or via REVIEWER_MODEL). */
  model: z.string().default('anthropic/claude-sonnet-4-5'),
  /** Optional shared prompt prepended to every agent + the coordinator. */
  sharedPrompt: z.string().optional(),
  coordinator: z.object({
    prompt: z.string(),
    model: z.string().optional(),
    temperature: z.number().optional(),
  }),
  agents: z.array(AgentConfigSchema).min(1),
  policy: z
    .object({
      includeSuggestions: z.boolean().default(false),
      maxFindings: z.number().int().positive().optional(),
    })
    .default({ includeSuggestions: false }),
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
