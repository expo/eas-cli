import { compileModsAsync } from '@expo/config-plugins';
import { getPrebuildConfigAsync } from '@expo/prebuild-config';

import { spawnExpoCommand } from '../../../utils/expoCli';
import { Client } from '../../../vcs/vcs';
import { isExpoInstalled } from '../../projectUtils';
import { hasIgnoredIosProjectAsync } from '../../workflow';
import { getManagedApplicationTargetEntitlementsAsync } from '../entitlements';

jest.mock('@expo/config-plugins', () => ({
  ...jest.requireActual('@expo/config-plugins'),
  compileModsAsync: jest.fn(),
}));
jest.mock('@expo/prebuild-config');
jest.mock('../../../log', () => ({
  __esModule: true,
  default: { warn: jest.fn() },
}));
jest.mock('../../../sentry', () => ({
  __esModule: true,
  default: {
    withScope: jest.fn(),
    captureMessage: jest.fn(),
  },
}));
jest.mock('../../../utils/expoCli');
jest.mock('../../projectUtils');
jest.mock('../../workflow');

const projectDir = '/project';
const vcsClient = {} as Client;
const prebuildConfig = {
  name: 'test-app',
  slug: 'test-app',
  ios: { bundleIdentifier: 'com.example.test' },
};
const entitlements = {
  'aps-environment': 'production',
  'com.apple.developer.associated-domains': ['applinks:example.com'],
};

beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(hasIgnoredIosProjectAsync).mockResolvedValue(true);
  jest.mocked(getPrebuildConfigAsync).mockResolvedValue({ exp: prebuildConfig } as any);
  jest.mocked(compileModsAsync).mockResolvedValue({
    ...prebuildConfig,
    ios: { ...prebuildConfig.ios, entitlements },
  } as any);
});

it('uses the bundled config fallback when Expo is not installed', async () => {
  jest.mocked(isExpoInstalled).mockReturnValue(false);
  const originalProcessEnv = process.env;
  let envDuringPrebuild: string | undefined;
  jest.mocked(getPrebuildConfigAsync).mockImplementation(async () => {
    envDuringPrebuild = process.env.TEST_ENTITLEMENTS_ENV;
    return { exp: prebuildConfig } as any;
  });

  await expect(
    getManagedApplicationTargetEntitlementsAsync(
      projectDir,
      { TEST_ENTITLEMENTS_ENV: 'from-build-profile' },
      vcsClient
    )
  ).resolves.toEqual(entitlements);

  expect(spawnExpoCommand).not.toHaveBeenCalled();
  expect(getPrebuildConfigAsync).toHaveBeenCalledWith(projectDir, { platforms: ['ios'] });
  expect(compileModsAsync).toHaveBeenCalledWith(prebuildConfig, {
    projectRoot: projectDir,
    platforms: ['ios'],
    introspect: true,
    ignoreExistingNativeFiles: true,
  });
  expect(envDuringPrebuild).toBe('from-build-profile');
  expect(process.env).toBe(originalProcessEnv);
});

it('uses the bundled config fallback when the local Expo CLI fails', async () => {
  jest.mocked(isExpoInstalled).mockReturnValue(true);
  jest
    .mocked(spawnExpoCommand)
    .mockRejectedValue(
      Object.assign(new Error('local Expo CLI failed'), { stderr: 'config failed' })
    );

  await expect(
    getManagedApplicationTargetEntitlementsAsync(projectDir, {}, vcsClient)
  ).resolves.toEqual(entitlements);

  expect(spawnExpoCommand).toHaveBeenCalledWith(
    projectDir,
    ['config', '--json', '--type', 'introspect'],
    { env: expect.objectContaining({ EXPO_NO_DOTENV: '1' }) }
  );
  expect(getPrebuildConfigAsync).toHaveBeenCalledWith(projectDir, { platforms: ['ios'] });
});

it('does not make Expo a required peer of the bundled config fallback', () => {
  const packageJson = require('@expo/prebuild-config/package.json') as {
    peerDependencies?: Record<string, string>;
    peerDependenciesMeta?: Record<string, { optional?: boolean }>;
  };

  const hasRequiredExpoPeer =
    packageJson.peerDependencies?.expo !== undefined &&
    packageJson.peerDependenciesMeta?.expo?.optional !== true;

  expect(hasRequiredExpoPeer).toBe(false);
});
