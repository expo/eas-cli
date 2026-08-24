import { LOADED_ENV_NAME } from '@expo/env';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { loadSimulatorEnvAsync } from '../env';

describe(loadSimulatorEnvAsync, () => {
  const originalEnv = process.env;
  let projectDir: string;

  beforeEach(async () => {
    projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'eas-simulator-env-'));
    process.env = {
      ...originalEnv,
      PARENT_DOTENV_VALUE: 'from-parent',
      SHARED_WITH_SHELL: 'from-shell',
      NODE_ENV: 'production',
      [LOADED_ENV_NAME]: '["PARENT_DOTENV_VALUE"]',
      __EXPO_CONFIG_MODE: 'production',
    };
    delete process.env.EXPO_NO_DOTENV;
  });

  afterEach(async () => {
    process.env = originalEnv;
    await fs.rm(projectDir, { force: true, recursive: true });
  });

  it('keeps shell values and gives simulator values priority over project dotenv values', async () => {
    await fs.writeFile(
      path.join(projectDir, '.env.development'),
      [
        'PROJECT_VALUE=from-project',
        'SHARED_WITH_SIMULATOR=from-project',
        'SHARED_WITH_SHELL=from-project',
        '__EXPO_CONFIG_MODE=from-project',
      ].join('\n')
    );
    await fs.writeFile(
      path.join(projectDir, '.env.eas-simulator'),
      [
        'SIMULATOR_VALUE=from-simulator',
        'SHARED_WITH_SIMULATOR=from-simulator',
        'SHARED_WITH_SHELL=from-simulator',
        '__EXPO_CONFIG_MODE=from-simulator',
      ].join('\n')
    );

    await loadSimulatorEnvAsync(projectDir);

    expect(process.env).toMatchObject({
      NODE_ENV: 'development',
      PROJECT_VALUE: 'from-project',
      SHARED_WITH_SHELL: 'from-shell',
      SHARED_WITH_SIMULATOR: 'from-simulator',
      SIMULATOR_VALUE: 'from-simulator',
    });
    expect(process.env.PARENT_DOTENV_VALUE).toBeUndefined();
    expect(process.env[LOADED_ENV_NAME]).toBeUndefined();
    expect(process.env.__EXPO_CONFIG_MODE).toBeUndefined();
  });
});
