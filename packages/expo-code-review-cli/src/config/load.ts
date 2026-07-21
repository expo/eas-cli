import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

import { ReviewConfigSchema } from './schema.js';
import type { LoadedAgent, LoadedConfig } from './schema.js';

export const CONFIG_DIRNAME = '.expo-code-review';

/** Default OpenCode tool toggles for a reviewer: read the repo, never mutate it. */
const DEFAULT_AGENT_TOOLS: Record<string, boolean> = {
  read: true,
  grep: true,
  glob: true,
  list: true,
  bash: false,
  write: false,
  edit: false,
  patch: false,
};

export function configDirFor(repoRoot: string): string {
  return path.join(repoRoot, CONFIG_DIRNAME);
}

export function hasConfig(repoRoot: string): boolean {
  const dir = configDirFor(repoRoot);
  return existsSync(path.join(dir, 'config.jsonc')) || existsSync(path.join(dir, 'config.json'));
}

/**
 * Discover and fully resolve a repo's review config from `.expo-code-review/`:
 * parse config.jsonc, read every prompt file, and resolve models (with an
 * optional REVIEWER_MODEL env override applied to all agents + the coordinator).
 */
export async function loadReviewConfig(repoRoot: string): Promise<LoadedConfig> {
  const dir = configDirFor(repoRoot);
  const configPath = ['config.jsonc', 'config.json']
    .map(name => path.join(dir, name))
    .find(candidate => existsSync(candidate));

  if (!configPath) {
    throw new Error(
      `No ${CONFIG_DIRNAME}/config.jsonc found in ${repoRoot}. Run \`ecr init\` to scaffold one.`
    );
  }

  const raw = await readFile(configPath, 'utf8');
  const parsed = ReviewConfigSchema.parse(JSON.parse(stripJsonComments(raw)));

  const readPrompt = async (relativePath: string): Promise<string> => {
    const promptPath = path.join(dir, relativePath);
    try {
      return await readFile(promptPath, 'utf8');
    } catch {
      throw new Error(`Prompt file not found: ${promptPath} (referenced from ${configPath})`);
    }
  };

  const override = process.env.REVIEWER_MODEL;
  const defaultModel = override ?? parsed.model;

  const sharedPromptText = parsed.sharedPrompt ? await readPrompt(parsed.sharedPrompt) : '';

  const agents: LoadedAgent[] = [];
  for (const agent of parsed.agents) {
    agents.push({
      id: agent.id,
      model: override ?? agent.model ?? defaultModel,
      temperature: agent.temperature ?? 0.1,
      tools: { ...DEFAULT_AGENT_TOOLS, ...(agent.tools ?? {}) },
      promptText: await readPrompt(agent.prompt),
    });
  }

  return {
    configDir: dir,
    sharedPromptText,
    agents,
    coordinator: {
      model: override ?? parsed.coordinator.model ?? defaultModel,
      temperature: parsed.coordinator.temperature ?? 0,
      promptText: await readPrompt(parsed.coordinator.prompt),
    },
    policy: parsed.policy,
    chunk: parsed.chunk,
    noise: parsed.noise,
    breakGlassMarker: parsed.breakGlass.marker,
    commentTag: parsed.commentTag,
    auth: {
      mode: parsed.auth.mode,
      provider: parsed.auth.provider,
      tokenEnv: parsed.auth.tokenEnv,
    },
  };
}

/**
 * Strip // line and /* *\/ block comments from JSONC, ignoring anything inside
 * string literals. The config is trusted (in-repo), so a light scanner suffices.
 */
export function stripJsonComments(input: string): string {
  let out = '';
  let inString = false;
  let inLine = false;
  let inBlock = false;
  for (let i = 0; i < input.length; i++) {
    const char = input[i]!;
    const next = input[i + 1];
    if (inLine) {
      if (char === '\n') {
        inLine = false;
        out += char;
      }
      continue;
    }
    if (inBlock) {
      if (char === '*' && next === '/') {
        inBlock = false;
        i++;
      }
      continue;
    }
    if (inString) {
      out += char;
      if (char === '\\') {
        out += input[i + 1] ?? '';
        i++;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      out += char;
    } else if (char === '/' && next === '/') {
      inLine = true;
      i++;
    } else if (char === '/' && next === '*') {
      inBlock = true;
      i++;
    } else {
      out += char;
    }
  }
  return out;
}
