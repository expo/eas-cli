import { Platform, Workflow } from '@expo/eas-build-job';
import plist from '@expo/plist';
import { Parser } from '@oclif/core';
import { vol } from 'memfs';

import { mockTestCommand } from '../../__tests__/commands/utils';
import { getBuildLogsUrl } from '../../build/utils/url';
import {
  AppPlatform,
  DistributionType,
  LocalBuildArchiveSourceType,
} from '../../graphql/generated';
import { FingerprintMutation } from '../../graphql/mutations/FingerprintMutation';
import { LocalBuildMutation } from '../../graphql/mutations/LocalBuildMutation';
import { getPrivateExpoConfigAsync } from '../../project/expoConfig';
import { resolveRuntimeVersionAsync } from '../../project/resolveRuntimeVersionAsync';
import { resolveWorkflowAsync } from '../../project/workflow';
import { uploadFileAtPathToGCSAsync } from '../../uploads';
import { resolveVcsClient } from '../../vcs';
import NoVcsClient from '../../vcs/clients/noVcs';
import BuildUpload, { extractAppMetadataAsync, resolveUploadMetadataAsync } from '../upload';

jest.mock('fs');
jest.mock('tar');
jest.mock('../../project/expoConfig');
jest.mock('../../project/resolveRuntimeVersionAsync');
jest.mock('../../project/workflow');
jest.mock('../../vcs');
jest.mock('../../uploads');
jest.mock('../../graphql/mutations/FingerprintMutation');
jest.mock('../../graphql/mutations/LocalBuildMutation');
jest.mock('../../build/utils/url');

const projectDir = '/project';
const options = { projectDir, platform: Platform.ANDROID, current: true, artifactMetadata: {} };
const vcsClient = new NoVcsClient();

beforeEach(() => {
  jest.resetAllMocks();
  vol.reset();
  vol.fromJSON({
    '/project/eas.json': JSON.stringify({
      build: {
        base: { channel: 'base', distribution: 'internal' },
        production: {
          extends: 'base',
          env: { APP_VARIANT: 'production' },
          android: { channel: 'android-production' },
        },
        store: {},
      },
    }),
  });
  jest.mocked(resolveVcsClient).mockReturnValue(vcsClient);
  jest.spyOn(vcsClient, 'getCommitHashAsync').mockResolvedValue('commit-hash');
  jest.spyOn(vcsClient, 'getLastCommitMessageAsync').mockResolvedValue('Commit message');
  jest.spyOn(vcsClient, 'hasUncommittedChangesAsync').mockResolvedValue(false);
  jest.mocked(getPrivateExpoConfigAsync).mockResolvedValue({
    name: 'Config name',
    slug: 'test',
    version: '1.2.3',
    android: { versionCode: 42 },
    ios: { buildNumber: '43' },
    sdkVersion: '55.0.0',
  });
  jest.mocked(resolveWorkflowAsync).mockResolvedValue(Workflow.MANAGED);
  jest.mocked(resolveRuntimeVersionAsync).mockResolvedValue({
    runtimeVersion: 'runtime',
    expoUpdatesRuntimeFingerprint: null,
    expoUpdatesRuntimeFingerprintHash: null,
  });
});

describe('upload flags', () => {
  it('defaults to artifact-only uploads', async () => {
    const { flags } = await Parser.parse([], { flags: BuildUpload.flags });
    expect(flags.current).toBeFalsy();
    expect(flags.profile).toBeUndefined();
  });

  it('accepts current-project metadata and a profile with an artifact path', async () => {
    const { flags } = await Parser.parse(
      ['--build-path', './app.apk', '--current', '--profile', 'production'],
      { flags: BuildUpload.flags }
    );
    expect(flags).toMatchObject({
      current: true,
      profile: 'production',
      'build-path': './app.apk',
    });
  });

  it('requires the current-state assertion when selecting a profile', async () => {
    await expect(
      Parser.parse(['--profile', 'production'], { flags: BuildUpload.flags })
    ).rejects.toThrow();
  });
});

describe('upload metadata', () => {
  it('does not read project or Git metadata without --current', async () => {
    const artifactMetadata = { appName: 'Artifact', fingerprintHash: 'fingerprint' };
    expect(await resolveUploadMetadataAsync({ ...options, current: false, artifactMetadata })).toBe(
      artifactMetadata
    );
    expect(getPrivateExpoConfigAsync).not.toHaveBeenCalled();
    expect(resolveVcsClient).not.toHaveBeenCalled();
  });

  it.each([
    [Platform.ANDROID, '42'],
    [Platform.IOS, '43'],
  ])('resolves %s project versions and clean Git metadata', async (platform, appBuildVersion) => {
    expect(await resolveUploadMetadataAsync({ ...options, platform })).toMatchObject({
      appVersion: '1.2.3',
      appBuildVersion,
      sdkVersion: '55.0.0',
      runtimeVersion: 'runtime',
      gitCommitHash: 'commit-hash',
      gitCommitMessage: 'Commit message',
      isGitWorkingTreeDirty: false,
    });
  });

  it('resolves profile inheritance, platform settings and config environment', async () => {
    expect(await resolveUploadMetadataAsync({ ...options, profile: 'production' })).toMatchObject({
      buildProfile: 'production',
      channel: 'android-production',
      distribution: DistributionType.Internal,
    });
    expect(getPrivateExpoConfigAsync).toHaveBeenCalledWith(projectDir, {
      env: { APP_VARIANT: 'production' },
    });
    expect(await resolveUploadMetadataAsync({ ...options, profile: 'store' })).toMatchObject({
      buildProfile: 'store',
      distribution: DistributionType.Store,
    });
  });

  it('prefers available artifact values without losing project fallbacks or false values', async () => {
    jest.mocked(vcsClient.hasUncommittedChangesAsync).mockResolvedValue(true);
    expect(
      await resolveUploadMetadataAsync({
        ...options,
        artifactMetadata: {
          appName: 'Artifact',
          appIdentifier: 'dev.artifact',
          appVersion: '2.0.0',
          appBuildVersion: undefined,
          runtimeVersion: null,
          developmentClient: false,
          fingerprintHash: 'artifact-fingerprint',
        },
      })
    ).toMatchObject({
      appName: 'Artifact',
      appIdentifier: 'dev.artifact',
      appVersion: '2.0.0',
      appBuildVersion: '42',
      runtimeVersion: 'runtime',
      developmentClient: false,
      fingerprintHash: 'artifact-fingerprint',
      isGitWorkingTreeDirty: true,
    });
  });

  it('keeps other metadata when Git and runtime resolution fail', async () => {
    const error = new Error('Unavailable');
    jest.mocked(vcsClient.getCommitHashAsync).mockRejectedValue(error);
    jest.mocked(vcsClient.getLastCommitMessageAsync).mockRejectedValue(error);
    jest.mocked(vcsClient.hasUncommittedChangesAsync).mockRejectedValue(error);
    jest.mocked(resolveRuntimeVersionAsync).mockRejectedValue(error);
    const metadata = await resolveUploadMetadataAsync(options);
    expect(metadata).toMatchObject({
      appVersion: '1.2.3',
      appBuildVersion: '42',
      sdkVersion: '55.0.0',
    });
    expect(metadata.gitCommitHash).toBeUndefined();
    expect(metadata.gitCommitMessage).toBeUndefined();
    expect(metadata.isGitWorkingTreeDirty).toBeUndefined();
    expect(metadata.runtimeVersion).toBeUndefined();
  });

  it('keeps Git and profile metadata when config cannot be read', async () => {
    jest.mocked(getPrivateExpoConfigAsync).mockRejectedValue(new Error('No config'));
    expect(await resolveUploadMetadataAsync({ ...options, profile: 'production' })).toMatchObject({
      gitCommitHash: 'commit-hash',
      buildProfile: 'production',
      distribution: DistributionType.Internal,
    });
  });

  it('leaves absent optional versions unset', async () => {
    jest.mocked(getPrivateExpoConfigAsync).mockResolvedValue({ name: 'Test', slug: 'test' });
    jest.mocked(resolveRuntimeVersionAsync).mockResolvedValue(null);
    const metadata = await resolveUploadMetadataAsync(options);
    expect(metadata.appVersion).toBeUndefined();
    expect(metadata.appBuildVersion).toBeUndefined();
    expect(metadata.sdkVersion).toBeUndefined();
    expect(metadata.runtimeVersion).toBeUndefined();
  });

  it('rejects an explicitly selected missing profile', async () => {
    await expect(resolveUploadMetadataAsync({ ...options, profile: 'missing' })).rejects.toThrow(
      'Missing build profile'
    );
  });
});

it('preserves app extraction and only includes artifact versions with --current', async () => {
  vol.fromJSON({
    '/project/App.app/Info.plist': plist.build({
      CFBundleDisplayName: 'Artifact',
      CFBundleIdentifier: 'dev.artifact',
      CFBundleShortVersionString: '2.0.0',
      CFBundleVersion: '100',
      DTPlatformName: 'iphonesimulator',
    }),
    '/project/App.app/EXUpdates.bundle/fingerprint': 'artifact-hash',
    '/project/App.app/EXDevMenu.bundle/menu': '',
  });
  const original = {
    appName: 'Artifact',
    appIdentifier: 'dev.artifact',
    simulator: true,
    developmentClient: true,
    fingerprintHash: 'artifact-hash',
  };
  expect(await extractAppMetadataAsync('/project/App.app', Platform.IOS)).toEqual(original);
  expect(await extractAppMetadataAsync('/project/App.app', Platform.IOS, true)).toEqual({
    ...original,
    appVersion: '2.0.0',
    appBuildVersion: '100',
  });
});

it.each([false, true])(
  'passes metadata to the local build mutation with current=%s',
  async current => {
    vol.fromJSON({ '/project/app.apk': 'mock archive' });
    // Use an unrecognized archive: extraction failure is already best-effort.
    vol.fromJSON({ '/project/app.tar': 'mock archive' });
    jest.mocked(uploadFileAtPathToGCSAsync).mockResolvedValue('bucket-key');
    jest.mocked(getBuildLogsUrl).mockReturnValue('https://example.com/build');
    const command = mockTestCommand(
      BuildUpload,
      [
        '--platform',
        'android',
        '--build-path',
        '/project/app.tar',
        '--fingerprint',
        'manual-hash',
        '--non-interactive',
        ...(current ? ['--current', '--profile', 'production'] : []),
      ],
      { projectId: 'project-id', projectDir, loggedIn: { graphqlClient: {} } }
    );
    await command.runAsync();
    expect(FingerprintMutation.createFingerprintAsync).toHaveBeenCalledWith({}, 'project-id', {
      hash: 'manual-hash',
    });
    expect(LocalBuildMutation.createLocalBuildAsync).toHaveBeenCalledWith(
      {},
      'project-id',
      { platform: AppPlatform.Android, simulator: false },
      { type: LocalBuildArchiveSourceType.Gcs, bucketKey: 'bucket-key' },
      expect.objectContaining({
        distribution: DistributionType.Internal,
        fingerprintHash: 'manual-hash',
        developmentClient: false,
        ...(current
          ? { appVersion: '1.2.3', buildProfile: 'production', gitCommitHash: 'commit-hash' }
          : {}),
      })
    );
    if (!current) {
      expect(getPrivateExpoConfigAsync).not.toHaveBeenCalled();
      expect(resolveVcsClient).not.toHaveBeenCalled();
    }
  }
);
