import { test, expect } from 'bun:test';

import { prepareAuth } from '../core/auth.js';
import type { LoadedConfig } from '../config/schema.js';

const cfg = (auth: unknown): LoadedConfig => ({ auth }) as unknown as LoadedConfig;

test('prepareAuth refuses to forward a well-known non-provider secret as tokenEnv', async () => {
  const prev = process.env.REVIEWER_MODEL;
  delete process.env.REVIEWER_MODEL; // ensure the guard path runs (override would skip it)
  try {
    await expect(
      prepareAuth(cfg({ mode: 'api-key', provider: 'anthropic', tokenEnv: 'GITHUB_TOKEN' }))
    ).rejects.toThrow(/non-provider secret/);
    await expect(
      prepareAuth(cfg({ mode: 'oauth', provider: 'anthropic', tokenEnv: 'AWS_SECRET_ACCESS_KEY' }))
    ).rejects.toThrow(/non-provider secret/);
  } finally {
    if (prev === undefined) {
      delete process.env.REVIEWER_MODEL;
    } else {
      process.env.REVIEWER_MODEL = prev;
    }
  }
});

test('prepareAuth: REVIEWER_MODEL override skips provider auth entirely (no throw)', async () => {
  const prev = process.env.REVIEWER_MODEL;
  process.env.REVIEWER_MODEL = 'openai/some-model';
  try {
    // Even a forbidden tokenEnv is a no-op under the local override path.
    const prepared = await prepareAuth(
      cfg({ mode: 'api-key', provider: 'anthropic', tokenEnv: 'GITHUB_TOKEN' })
    );
    await prepared.cleanup();
  } finally {
    if (prev === undefined) {
      delete process.env.REVIEWER_MODEL;
    } else {
      process.env.REVIEWER_MODEL = prev;
    }
  }
});
