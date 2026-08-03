import { Workflow } from '@expo/eas-build-job';
import { EasJsonAccessor } from '@expo/eas-json';
import fs from 'fs-extra';
import { vol } from 'memfs';

import {
  DEFAULT_BARE_RUNTIME_VERSION,
  DEFAULT_MANAGED_RUNTIME_VERSION_GTE_SDK_49,
  DEFAULT_MANAGED_RUNTIME_VERSION_LTE_SDK_48,
  ensureEASUpdateIsConfiguredInEasJsonAsync,
  getDefaultRuntimeVersion,
} from '../configure';

jest.mock('fs');
jest.mock('../../log');

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

describe(ensureEASUpdateIsConfiguredInEasJsonAsync, () => {
  const easJsonPath = EasJsonAccessor.formatEasJsonPath('.');

  beforeEach(() => {
    vol.reset();
  });

  function volWithEasJson(build: Record<string, object>): void {
    vol.fromJSON({
      './eas.json': `${JSON.stringify({ cli: { version: '>= 1.0.0' }, build }, null, 2)}\n`,
    });
  }

  async function readBuildProfilesAsync(): Promise<any> {
    const easJsonAccessor = EasJsonAccessor.fromProjectPath('.');
    const easJson = await easJsonAccessor.readRawJsonAsync();
    return easJson.build;
  }

  it('adds a channel to every profile without one', async () => {
    volWithEasJson({
      development: { developmentClient: true, distribution: 'internal' },
      preview: { distribution: 'internal' },
      production: { channel: 'custom' },
    });

    await ensureEASUpdateIsConfiguredInEasJsonAsync('.');

    const build = await readBuildProfilesAsync();
    expect(build.development.channel).toBe('development');
    expect(build.preview.channel).toBe('preview');
    expect(build.production.channel).toBe('custom');
  });

  it('does not rewrite eas.json when every profile already has a channel', async () => {
    volWithEasJson({
      preview: { channel: 'shared' },
      production: { channel: 'custom' },
    });
    const before = await fs.readFile(easJsonPath, 'utf8');

    await ensureEASUpdateIsConfiguredInEasJsonAsync('.');

    const after = await fs.readFile(easJsonPath, 'utf8');
    expect(after).toBe(before);
    const build = await readBuildProfilesAsync();
    expect(build.preview.channel).toBe('shared');
    expect(build.production.channel).toBe('custom');
  });

  it('resolves without error when eas.json does not exist', async () => {
    await expect(ensureEASUpdateIsConfiguredInEasJsonAsync('.')).resolves.toBeUndefined();
  });
});
