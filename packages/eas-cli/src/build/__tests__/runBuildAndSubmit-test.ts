import { EasJsonUtils } from '@expo/eas-json';

import { ensureProjectConfiguredAsync } from '../configure';
import { BuildFlags, runBuildAndSubmitAsync } from '../runBuildAndSubmit';
import { reviewAndCommitChangesAsync } from '../utils/repository';
import { Analytics } from '../../analytics/AnalyticsManager';
import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { RequestedPlatform } from '../../platform';
import {
  ensureEASUpdateIsConfiguredAsync,
  ensureEASUpdateIsConfiguredInEasJsonAsync,
} from '../../update/configure';
import { Actor } from '../../user/User';
import { getProfilesAsync } from '../../utils/profiles';
import { Client } from '../../vcs/vcs';

jest.mock('../configure');
jest.mock('../utils/repository');
jest.mock('../utils/devClient');
jest.mock('../utils/printBuildInfo');
jest.mock('../../update/configure');
jest.mock('../../utils/profiles');
jest.mock('../../project/discourageExpoGoForProdAsync');
jest.mock('../../log');
jest.mock('@expo/eas-json', () => {
  const actual = jest.requireActual('@expo/eas-json');
  return {
    ...actual,
    EasJsonAccessor: { fromProjectPath: jest.fn(() => ({})) },
    EasJsonUtils: { getCliConfigAsync: jest.fn() },
  };
});

const projectDir = '/app';
const projectId = 'e0b6b8fc-1e2b-4b1c-9c7f-2d3a4b5c6d7e';
const exp = { name: 'test-app', slug: 'test-app' };

function createVcsClient(
  { isCommitRequired }: { isCommitRequired: boolean } = { isCommitRequired: false }
): Client {
  return {
    ensureRepoExistsAsync: jest.fn(),
    isCommitRequiredAsync: jest.fn().mockResolvedValue(isCommitRequired),
  } as unknown as Client;
}

function createFlags(overrides: Partial<BuildFlags> = {}): BuildFlags {
  return {
    requestedPlatform: RequestedPlatform.Android,
    nonInteractive: false,
    wait: false,
    clearCache: false,
    json: false,
    autoSubmit: false,
    localBuildOptions: {},
    freezeCredentials: false,
    autoConfigureUpdate: false,
    ...overrides,
  };
}

async function runAsync({
  flags,
  vcsClient = createVcsClient(),
  envOverride,
}: {
  flags: BuildFlags;
  vcsClient?: Client;
  envOverride?: Record<string, string>;
}): Promise<void> {
  await runBuildAndSubmitAsync({
    graphqlClient: {} as ExpoGraphqlClient,
    analytics: {} as Analytics,
    vcsClient,
    projectDir,
    flags,
    actor: {} as Actor,
    getDynamicPrivateProjectConfigAsync: jest.fn().mockResolvedValue({ exp, projectId }),
    envOverride,
  });
}

describe(runBuildAndSubmitAsync, () => {
  beforeEach(() => {
    jest.resetAllMocks();
    jest.mocked(getProfilesAsync).mockResolvedValue([]);
    jest.mocked(ensureProjectConfiguredAsync).mockResolvedValue(true);
    jest.mocked(EasJsonUtils.getCliConfigAsync).mockResolvedValue({});
  });

  describe('--auto-configure-update', () => {
    it('does not configure EAS Update when the flag is not set', async () => {
      await runAsync({ flags: createFlags({ autoConfigureUpdate: false }) });

      expect(ensureEASUpdateIsConfiguredAsync).not.toHaveBeenCalled();
      expect(ensureEASUpdateIsConfiguredInEasJsonAsync).not.toHaveBeenCalled();
    });

    it('configures EAS Update with the requested platform and env when the flag is set', async () => {
      const envOverride = { MY_VAR: 'value' };
      jest
        .mocked(EasJsonUtils.getCliConfigAsync)
        .mockResolvedValue({ updateManifestHostOverride: 'https://custom.example.com' });

      await runAsync({
        flags: createFlags({
          autoConfigureUpdate: true,
          requestedPlatform: RequestedPlatform.Ios,
        }),
        envOverride,
      });

      expect(ensureEASUpdateIsConfiguredAsync).toHaveBeenCalledWith({
        exp,
        projectId,
        projectDir,
        vcsClient: expect.anything(),
        platform: RequestedPlatform.Ios,
        env: envOverride,
        manifestHostOverride: 'https://custom.example.com',
      });
    });

    it('passes a null manifestHostOverride when eas.json does not set one', async () => {
      await runAsync({ flags: createFlags({ autoConfigureUpdate: true }) });

      expect(ensureEASUpdateIsConfiguredAsync).toHaveBeenCalledWith(
        expect.objectContaining({ manifestHostOverride: null })
      );
    });

    it('adds channels to all build profiles regardless of the selected profile', async () => {
      await runAsync({ flags: createFlags({ autoConfigureUpdate: true, profile: 'preview' }) });

      expect(ensureEASUpdateIsConfiguredInEasJsonAsync).toHaveBeenCalledWith(projectDir);
    });

    it('commits the changes when the configuration modified the working tree', async () => {
      await runAsync({
        flags: createFlags({ autoConfigureUpdate: true, nonInteractive: true }),
        vcsClient: createVcsClient({ isCommitRequired: true }),
      });

      expect(reviewAndCommitChangesAsync).toHaveBeenCalledWith(
        expect.anything(),
        'Configure EAS Update',
        { nonInteractive: true }
      );
    });

    it('does not commit when the configuration left the working tree unchanged', async () => {
      await runAsync({
        flags: createFlags({ autoConfigureUpdate: true }),
        vcsClient: createVcsClient({ isCommitRequired: false }),
      });

      expect(reviewAndCommitChangesAsync).not.toHaveBeenCalled();
    });
  });
});
