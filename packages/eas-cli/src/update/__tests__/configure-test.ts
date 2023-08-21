import { Workflow } from '@expo/eas-build-job';

import {
  DEFAULT_BARE_RUNTIME_VERSION,
  DEFAULT_MANAGED_RUNTIME_VERSION_GTE_SDK_49,
  DEFAULT_MANAGED_RUNTIME_VERSION_LTE_SDK_48,
  getDefaultRuntimeVersion,
} from '../configure';

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
