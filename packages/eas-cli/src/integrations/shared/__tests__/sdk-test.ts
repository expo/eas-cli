import spawnAsync from '@expo/spawn-async';
import { ExpoConfig } from '@expo/config';

import Log from '../../../log';
import { createOrModifyExpoConfigAsync } from '../../../project/expoConfig';
import {
  addConfigPluginAsync,
  envForExpoInstall,
  extractDynamicConfigGuidance,
  getSpawnErrorOutput,
  installSdkPackagesAsync,
  setupSdkAndConfigAsync,
} from '../sdk';

jest.mock('@expo/spawn-async');
jest.mock('../../../project/expoConfig');
jest.mock('../../../log');
jest.mock('../../../ora', () => ({
  ora: jest.fn(() => ({
    start: jest.fn().mockReturnThis(),
    succeed: jest.fn().mockReturnThis(),
    warn: jest.fn().mockReturnThis(),
    fail: jest.fn().mockReturnThis(),
  })),
}));

const packages = ['example-sdk', 'example-plugin-pkg'];
const plugin = 'example-plugin-pkg';
const label = 'Example';

describe('shared sdk helpers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('getSpawnErrorOutput concatenates stdout and stderr', () => {
    expect(getSpawnErrorOutput({ stdout: 'out', stderr: 'err' })).toBe('outerr');
    expect(getSpawnErrorOutput(null)).toBe('');
  });

  it('extractDynamicConfigGuidance returns guidance after the marker', () => {
    expect(extractDynamicConfigGuidance('no marker here')).toBeNull();
    expect(
      extractDynamicConfigGuidance('prefix Cannot automatically write to dynamic config: do this')
    ).toBe('Cannot automatically write to dynamic config: do this');
  });

  it('envForExpoInstall strips Expo local env vars', () => {
    const original = process.env;
    process.env = {
      ...original,
      EXPO_LOCAL: '1',
      EXPO_STAGING: '1',
      EXPO_UNIVERSE_DIR: '/tmp',
      KEEP: 'yes',
    };
    try {
      const env = envForExpoInstall();
      expect(env.KEEP).toBe('yes');
      expect(env.EXPO_LOCAL).toBeUndefined();
      expect(env.EXPO_STAGING).toBeUndefined();
      expect(env.EXPO_UNIVERSE_DIR).toBeUndefined();
    } finally {
      process.env = original;
    }
  });
});

describe('installSdkPackagesAsync', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns installed on success', async () => {
    jest.mocked(spawnAsync).mockResolvedValue({} as never);
    await expect(
      installSdkPackagesAsync('/project', { packages, label, jsonFlag: false })
    ).resolves.toEqual({
      status: 'installed',
    });
    expect(spawnAsync).toHaveBeenCalledWith(
      'npx',
      ['expo', 'install', ...packages],
      expect.objectContaining({ cwd: '/project' })
    );
  });

  it('returns dynamic config guidance when install output includes it', async () => {
    jest.mocked(spawnAsync).mockRejectedValue({
      stdout: '',
      stderr: 'Cannot automatically write to dynamic config\nAdd plugin manually',
    });

    await expect(
      installSdkPackagesAsync('/project', { packages, label, jsonFlag: true })
    ).resolves.toEqual({
      status: 'installed',
      dynamicConfigGuidance: expect.stringContaining(
        'Cannot automatically write to dynamic config'
      ),
    });
  });

  it('returns failed when install fails without guidance', async () => {
    jest.mocked(spawnAsync).mockRejectedValue(new Error('boom'));
    await expect(
      installSdkPackagesAsync('/project', { packages, label, jsonFlag: true })
    ).resolves.toEqual({
      status: 'failed',
    });
  });
});

describe('addConfigPluginAsync', () => {
  const exp = { name: 'app', slug: 'app' } as ExpoConfig;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('skips when plugin is already present as a string or tuple', async () => {
    await expect(
      addConfigPluginAsync(
        '/project',
        {
          ...exp,
          plugins: [[plugin, {}], 'other'],
        },
        { plugin }
      )
    ).resolves.toBeNull();
    await expect(
      addConfigPluginAsync(
        '/project',
        {
          ...exp,
          plugins: [plugin],
        },
        { plugin }
      )
    ).resolves.toBeNull();
    expect(createOrModifyExpoConfigAsync).not.toHaveBeenCalled();
    expect(Log.withTick).toHaveBeenCalled();
  });

  it('returns null on successful modification', async () => {
    jest.mocked(createOrModifyExpoConfigAsync).mockResolvedValue({ type: 'success' } as never);
    await expect(addConfigPluginAsync('/project', exp, { plugin })).resolves.toBeNull();
  });

  it('returns warn message when modification warns', async () => {
    jest
      .mocked(createOrModifyExpoConfigAsync)
      .mockResolvedValue({ type: 'warn', message: 'dynamic config' } as never);
    await expect(addConfigPluginAsync('/project', exp, { plugin })).resolves.toContain(
      'dynamic config'
    );
  });

  it('returns fallback message for other modification results', async () => {
    jest.mocked(createOrModifyExpoConfigAsync).mockResolvedValue({ type: 'fail' } as never);
    await expect(addConfigPluginAsync('/project', exp, { plugin })).resolves.toContain(
      JSON.stringify(plugin)
    );
  });
});

describe('setupSdkAndConfigAsync', () => {
  const exp = { name: 'app', slug: 'app' } as ExpoConfig;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('adds install failure guidance', async () => {
    jest.mocked(spawnAsync).mockRejectedValue(new Error('nope'));
    jest.mocked(createOrModifyExpoConfigAsync).mockResolvedValue({ type: 'success' } as never);

    const steps = await setupSdkAndConfigAsync('/project', exp, {
      packages,
      plugin,
      label,
      jsonFlag: true,
    });
    expect(steps[0]).toContain('npx expo install');
  });

  it('prefers dynamic config guidance over adding the plugin', async () => {
    jest.mocked(spawnAsync).mockRejectedValue({
      stderr: 'Cannot automatically write to dynamic config\nmanual',
    });

    const steps = await setupSdkAndConfigAsync('/project', exp, {
      packages,
      plugin,
      label,
      jsonFlag: true,
    });
    expect(steps).toEqual([
      expect.stringContaining('Cannot automatically write to dynamic config'),
    ]);
    expect(createOrModifyExpoConfigAsync).not.toHaveBeenCalled();
  });

  it('includes plugin manual steps when needed', async () => {
    jest.mocked(spawnAsync).mockResolvedValue({} as never);
    jest
      .mocked(createOrModifyExpoConfigAsync)
      .mockResolvedValue({ type: 'warn', message: 'edit app.config.js' } as never);

    const steps = await setupSdkAndConfigAsync('/project', exp, {
      packages,
      plugin,
      label,
      jsonFlag: true,
    });
    expect(steps[0]).toContain('edit app.config.js');
  });
});
