import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { LoadedConfig } from '../config/schema.js';

export interface PreparedAuth {
  cleanup: () => Promise<void>;
}

/** Env var each provider's SDK reads for an API key (x-api-key style). */
const PROVIDER_KEY_ENV: Record<string, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  google: 'GOOGLE_GENERATIVE_AI_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
};

const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * Prepare model credentials for the OpenCode server based on the repo's auth mode.
 * Must run before the server starts (it mutates env). Returns a cleanup handle.
 *
 * - `api-key`: copy the configured token env into the provider's API-key env var
 *   (so the workflow can pass a namespaced secret and OpenCode still finds it).
 * - `oauth`: write an isolated OpenCode `auth.json` with the token as a Bearer
 *   OAuth credential and point OpenCode at it via XDG_DATA_HOME, so it uses its
 *   native Claude Pro/Max path (correct bearer + oauth headers) rather than
 *   x-api-key. Isolated so it never touches the developer's real auth.json.
 */
export async function prepareAuth(config: LoadedConfig): Promise<PreparedAuth> {
  const noop: PreparedAuth = { cleanup: async () => {} };
  const { mode, provider, tokenEnv } = config.auth;

  // REVIEWER_MODEL is an explicit "use this model with my own creds" override — a
  // common local case (e.g. the repo config targets Claude OAuth in CI, but a dev
  // runs against their own OpenAI login). Don't inject the configured provider's
  // auth; let OpenCode use whatever it's logged into for the override model.
  if (process.env.REVIEWER_MODEL) {
    return noop;
  }

  if (mode === 'api-key') {
    if (tokenEnv) {
      const value = process.env[tokenEnv];
      const target = PROVIDER_KEY_ENV[provider] ?? 'ANTHROPIC_API_KEY';
      if (value && !process.env[target]) {
        process.env[target] = value;
      }
    }
    return noop;
  }

  // oauth
  if (!tokenEnv) {
    throw new Error(
      'auth.mode "oauth" requires auth.tokenEnv to name the env var holding the OAuth token.'
    );
  }
  const token = process.env[tokenEnv];
  if (!token) {
    throw new Error(`OAuth token env "${tokenEnv}" is not set.`);
  }

  const dir = await mkdtemp(path.join(tmpdir(), 'ecr-auth-'));
  await mkdir(path.join(dir, 'opencode'), { recursive: true });
  const authJson = {
    [provider]: {
      type: 'oauth',
      access: token,
      refresh: '',
      // Far-future expiry so OpenCode uses the token as-is and does not try to
      // refresh it (setup-token tokens are long-lived and carry no refresh).
      expires: Date.now() + YEAR_MS,
    },
  };
  await writeFile(path.join(dir, 'opencode', 'auth.json'), JSON.stringify(authJson), 'utf8');
  process.env.XDG_DATA_HOME = dir;

  return {
    cleanup: async () => {
      await rm(dir, { recursive: true, force: true });
    },
  };
}
