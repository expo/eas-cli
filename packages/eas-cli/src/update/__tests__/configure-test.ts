import { Workflow } from '@expo/eas-build-job';

import {
  DEFAULT_BARE_RUNTIME_VERSION,
  DEFAULT_MANAGED_RUNTIME_VERSION_GTE_SDK_49,
  DEFAULT_MANAGED_RUNTIME_VERSION_LTE_SDK_48,
  ensureEASUpdateIsConfiguredAsync,
  getDefaultRuntimeVersion,
} from '../configure';
import { createOrModifyExpoConfigAsync } from '../../project/expoConfig';
import { RequestedPlatform } from '../../platform';
import {
  isExpoUpdatesInstalledAsDevDependency,
  isExpoUpdatesInstalledOrAvailable,
} from '../../project/projectUtils';
import { resolveWorkflowPerPlatformAsync } from '../../project/workflow';

jest.mock('../../project/expoConfig');
jest.mock('../../project/projectUtils');
jest.mock('../../project/workflow');

describe(getDefaultRuntimeVersion, () => {
  it('gets the right rtv version/policy', () => {
    expect(getDefaultRuntimeVersion(Workflow.MANAGED, '48.0.0')).toBe(
      DEFAULT_MANAGED_RUNTIME_VERSION_LTE_SDK_48
    );
    expect(getDefaultRuntimeVersion(Workflow.MANAGED, '49.0.0')).toBe(
      DEFAULT_MANAGED_RUNTIME_VERSION_GTE_SDK_49
    );
    expect(getDefaultRuntimeVersion(Workflow.MANAGED, '50.0.0')).toBe(
      DEFAULT_MANAGED_RUNTIME_VERSION_GTE_SDK_49
    );
    expect(getDefaultRuntimeVersion(Workflow.MANAGED, 'sdf')).toBe(
      DEFAULT_MANAGED_RUNTIME_VERSION_LTE_SDK_48
    );
    expect(getDefaultRuntimeVersion(Workflow.MANAGED, undefined)).toBe(
      DEFAULT_MANAGED_RUNTIME_VERSION_LTE_SDK_48
    );

    expect(getDefaultRuntimeVersion(Workflow.UNKNOWN, '48.0.0')).toBe(
      DEFAULT_MANAGED_RUNTIME_VERSION_LTE_SDK_48
    );
    expect(getDefaultRuntimeVersion(Workflow.UNKNOWN, '49.0.0')).toBe(
      DEFAULT_MANAGED_RUNTIME_VERSION_GTE_SDK_49
    );
    expect(getDefaultRuntimeVersion(Workflow.UNKNOWN, '50.0.0')).toBe(
      DEFAULT_MANAGED_RUNTIME_VERSION_GTE_SDK_49
    );
    expect(getDefaultRuntimeVersion(Workflow.UNKNOWN, 'sdf')).toBe(
      DEFAULT_MANAGED_RUNTIME_VERSION_LTE_SDK_48
    );
    expect(getDefaultRuntimeVersion(Workflow.UNKNOWN, undefined)).toBe(
      DEFAULT_MANAGED_RUNTIME_VERSION_LTE_SDK_48
    );

    expect(getDefaultRuntimeVersion(Workflow.GENERIC, '48.0.0')).toBe(DEFAULT_BARE_RUNTIME_VERSION);
    expect(getDefaultRuntimeVersion(Workflow.GENERIC, '49.0.0')).toBe(DEFAULT_BARE_RUNTIME_VERSION);
    expect(getDefaultRuntimeVersion(Workflow.GENERIC, '50.0.0')).toBe(DEFAULT_BARE_RUNTIME_VERSION);
    expect(getDefaultRuntimeVersion(Workflow.GENERIC, 'sdf')).toBe(DEFAULT_BARE_RUNTIME_VERSION);
    expect(getDefaultRuntimeVersion(Workflow.GENERIC, undefined)).toBe(
      DEFAULT_BARE_RUNTIME_VERSION
    );
  });
});

describe(ensureEASUpdateIsConfiguredAsync, () => {
  it('uses the selected env when it updates app config', async () => {
    const env = { APP_VARIANT: 'from-eas', EXPO_NO_DOTENV: '1' };
    const exp = { name: 'app', slug: 'app', sdkVersion: '55.0.0' };
    jest.mocked(isExpoUpdatesInstalledOrAvailable).mockReturnValue(true);
    jest.mocked(isExpoUpdatesInstalledAsDevDependency).mockReturnValue(false);
    jest.mocked(resolveWorkflowPerPlatformAsync).mockResolvedValue({
      android: Workflow.MANAGED,
      ios: Workflow.MANAGED,
    });
    jest.mocked(createOrModifyExpoConfigAsync).mockResolvedValue({
      type: 'success',
      config: exp,
    } as any);

    await ensureEASUpdateIsConfiguredAsync({
      env,
      exp,
      manifestHostOverride: null,
      platform: RequestedPlatform.All,
      projectDir: '/app',
      projectId: 'project-id',
      vcsClient: {} as any,
    });

    expect(createOrModifyExpoConfigAsync).toHaveBeenCalledWith('/app', expect.any(Object), {
      env,
      mode: 'production',
    });
  });
});
