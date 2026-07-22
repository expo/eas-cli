import { readdir, readFile } from 'node:fs/promises';
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

  const override = process.env.REVIEWER_MODEL;
  const defaultModel = override ?? parsed.model;
  const resolveModel = (frontmatterModel?: string): string =>
    override ?? frontmatterModel ?? defaultModel;
  const resolveTemp = (value: string | undefined, fallback: number): number => {
    const n = value == null ? NaN : Number(value);
    return Number.isFinite(n) ? n : fallback;
  };

  // shared.md is optional; the coordinator is required.
  const sharedPath = path.join(dir, 'shared.md');
  const sharedPromptText = existsSync(sharedPath)
    ? parseFrontmatter(await readFile(sharedPath, 'utf8')).body
    : '';

  const coordinatorPath = path.join(dir, 'coordinator.md');
  if (!existsSync(coordinatorPath)) {
    throw new Error(`Missing ${CONFIG_DIRNAME}/coordinator.md`);
  }
  const coordinatorMd = parseFrontmatter(await readFile(coordinatorPath, 'utf8'));

  // Every markdown file in agents/ is a reviewer agent (id = filename).
  const agentsDir = path.join(dir, 'agents');
  if (!existsSync(agentsDir)) {
    throw new Error(`Missing ${CONFIG_DIRNAME}/agents/ directory. Run \`ecr init\`.`);
  }
  const agentFiles = (await readdir(agentsDir)).filter(name => name.endsWith('.md')).sort();
  if (agentFiles.length === 0) {
    throw new Error(`No agent markdown files in ${CONFIG_DIRNAME}/agents/.`);
  }

  const agents: LoadedAgent[] = [];
  for (const file of agentFiles) {
    const md = parseFrontmatter(await readFile(path.join(agentsDir, file), 'utf8'));
    const id = file.replace(/\.md$/, '');
    agents.push({
      id,
      description: md.data.description ?? '',
      alwaysRun: /^(true|yes|1)$/i.test(md.data.alwaysRun ?? ''),
      model: resolveModel(md.data.model),
      temperature: resolveTemp(md.data.temperature, 0.1),
      tools: DEFAULT_AGENT_TOOLS,
      promptText: md.body,
    });
  }

  return {
    configDir: dir,
    sharedPromptText,
    agents,
    coordinator: {
      model: resolveModel(coordinatorMd.data.model),
      temperature: resolveTemp(coordinatorMd.data.temperature, 0),
      promptText: coordinatorMd.body,
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
 * Parse optional YAML-ish frontmatter (simple `key: value` scalars) from the top
 * of a markdown file. Returns the parsed keys and the body with frontmatter
 * stripped. Supports per-agent overrides like `model:` and `temperature:`.
 */
export function parseFrontmatter(md: string): { data: Record<string, string>; body: string } {
  if (!md.startsWith('---')) {
    return { data: {}, body: md };
  }
  const end = md.indexOf('\n---', 3);
  if (end === -1) {
    return { data: {}, body: md };
  }
  const header = md.slice(3, end).trim();
  const body = md.slice(end + 4).replace(/^\r?\n/, '');
  const data: Record<string, string> = {};
  for (const line of header.split('\n')) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (match) {
      data[match[1]!] = match[2]!.trim().replace(/^["']|["']$/g, '');
    }
  }
  return { data, body };
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
