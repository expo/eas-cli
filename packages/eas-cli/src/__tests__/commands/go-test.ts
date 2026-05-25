import { getConfigFilePaths } from '@expo/config';

import { getWorkflowRunUrl } from '../../build/utils/url';
import Go from '../../commands/go';
import { WorkflowRunStatus } from '../../graphql/generated';
import { WorkflowRunMutation } from '../../graphql/mutations/WorkflowRunMutation';
import { WorkflowRunQuery } from '../../graphql/queries/WorkflowRunQuery';
import Log from '../../log';
import { selectAsync } from '../../prompts';
import { getPrivateExpoConfigAsync } from '../../project/expoConfig';
import { uploadAccountScopedFileAsync } from '../../project/uploadAccountScopedFileAsync';
import { uploadAccountScopedProjectSourceAsync } from '../../project/uploadAccountScopedProjectSourceAsync';
import { ensureActorHasPrimaryAccount } from '../../user/actions';
import { detectProjectSdkVersionAsync } from '../../commands/go';
import { mockTestCommand } from './utils';

jest.mock('@expo/config', () => ({
  ...jest.requireActual('@expo/config'),
  getConfigFilePaths: jest.fn(),
}));
jest.mock('../../project/expoConfig');
jest.mock('../../log', () => ({
  __esModule: true,
  default: {
    log: jest.fn(),
    withTick: jest.fn(),
    newLine: jest.fn(),
    succeed: jest.fn(),
    debug: jest.fn(),
    markFreshLine: jest.fn(),
    error: jest.fn(),
  },
  learnMore: jest.fn().mockReturnValue(''),
}));
jest.mock('../../ora', () => ({
  ora: jest.fn().mockReturnValue({
    start: jest.fn().mockReturnThis(),
    stop: jest.fn().mockReturnThis(),
    fail: jest.fn().mockReturnThis(),
    succeed: jest.fn().mockReturnThis(),
  }),
}));
jest.mock('fs-extra', () => ({
  ensureDir: jest.fn().mockResolvedValue(undefined),
  writeFile: jest.fn().mockResolvedValue(undefined),
  remove: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../user/actions');
jest.mock('../../graphql/queries/WorkflowRunQuery');
jest.mock('../../graphql/mutations/WorkflowRunMutation');
jest.mock('../../project/uploadAccountScopedFileAsync');
jest.mock('../../project/uploadAccountScopedProjectSourceAsync');
jest.mock('../../build/utils/url');
jest.mock('../../prompts');

const mockGetConfigFilePaths = jest.mocked(getConfigFilePaths);
const mockGetPrivateExpoConfigAsync = jest.mocked(getPrivateExpoConfigAsync);

describe('detectProjectSdkVersionAsync', () => {
  it('returns undefined when no config file exists', async () => {
    mockGetConfigFilePaths.mockReturnValue({ staticConfigPath: null, dynamicConfigPath: null });
    await expect(detectProjectSdkVersionAsync('/project')).resolves.toBeUndefined();
  });

  it('returns the sdkVersion from the project config', async () => {
    mockGetConfigFilePaths.mockReturnValue({
      staticConfigPath: '/project/app.json',
      dynamicConfigPath: null,
    });
    mockGetPrivateExpoConfigAsync.mockResolvedValue({ sdkVersion: '55.0.0' } as any);
    await expect(detectProjectSdkVersionAsync('/project')).resolves.toBe('55.0.0');
  });

  it('returns undefined when reading the config throws', async () => {
    mockGetConfigFilePaths.mockReturnValue({
      staticConfigPath: '/project/app.json',
      dynamicConfigPath: null,
    });
    mockGetPrivateExpoConfigAsync.mockRejectedValue(new Error('config error'));
    await expect(detectProjectSdkVersionAsync('/project')).resolves.toBeUndefined();
  });
});

const mockAccount = { id: 'account-id', name: 'testuser' };
const mockActor = {
  __typename: 'User' as const,
  id: 'user-id',
  username: 'testuser',
  primaryAccount: mockAccount,
};

describe('Go command', () => {
  beforeEach(() => {
    jest.mocked(ensureActorHasPrimaryAccount).mockReturnValue(mockAccount as any);
    jest.mocked(WorkflowRunQuery.expoGoRepackConfigurationAsync).mockResolvedValue({
      files: [],
      sdkVersion: '55.0.0',
    } as any);
    jest.mocked(WorkflowRunMutation.createExpoGoRepackWorkflowRunAsync).mockResolvedValue({
      id: 'run-id',
    } as any);
    jest.mocked(uploadAccountScopedProjectSourceAsync).mockResolvedValue({
      projectArchiveBucketKey: 'archive-key',
    });
    jest
      .mocked(uploadAccountScopedFileAsync)
      .mockResolvedValue({ fileBucketKey: 'file-key' } as any);
    jest.mocked(getWorkflowRunUrl).mockReturnValue('https://expo.dev/run/123');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  function makeCmd(argv: string[] = []) {
    const ctx = {
      loggedIn: { actor: mockActor as any, graphqlClient: {} as any },
      analytics: {} as any,
    };
    const cmd = mockTestCommand(Go, ['--bundle-id', 'com.test.go', ...argv], ctx);
    jest.spyOn(cmd as any, 'ensureEasProjectAsync').mockResolvedValue('project-id');
    jest.spyOn(cmd as any, 'setupCredentialsAsync').mockResolvedValue({ id: 'asc-app-id' });
    jest.spyOn(cmd as any, 'monitorWorkflowJobsAsync').mockResolvedValue(WorkflowRunStatus.Success);
    return cmd;
  }

  it('logs auto-selected SDK message and reports resolved version after dispatch', async () => {
    mockGetConfigFilePaths.mockReturnValue({
      staticConfigPath: '/app.json',
      dynamicConfigPath: null,
    });
    mockGetPrivateExpoConfigAsync.mockResolvedValue({ sdkVersion: '55.0.0' } as any);

    await makeCmd().run();

    expect(Log.log).toHaveBeenCalledWith(expect.stringContaining('SDK 55'));
    expect(Log.withTick).toHaveBeenCalledWith(expect.stringContaining('Using Expo Go SDK'));
  });

  it('skips auto-select log when --sdk-version flag is provided', async () => {
    mockGetConfigFilePaths.mockReturnValue({
      staticConfigPath: '/app.json',
      dynamicConfigPath: null,
    });
    mockGetPrivateExpoConfigAsync.mockResolvedValue({ sdkVersion: '55.0.0' } as any);

    await makeCmd(['--sdk-version', '55.0.0']).run();

    expect(Log.log).not.toHaveBeenCalledWith(expect.stringContaining('Auto-selected'));
  });

  it('prompts for SDK version when no project config is found', async () => {
    mockGetConfigFilePaths.mockReturnValue({ staticConfigPath: null, dynamicConfigPath: null });
    jest.mocked(WorkflowRunQuery.expoGoSupportedSdkVersionsAsync).mockResolvedValue([
      { sdkVersion: '54.0.0', isLatest: false, isBeta: false, isDeprecated: false },
      { sdkVersion: '55.0.0', isLatest: true, isBeta: false, isDeprecated: false },
      { sdkVersion: '56.0.0', isLatest: false, isBeta: true, isDeprecated: false },
    ]);
    jest.mocked(selectAsync).mockResolvedValue('55.0.0');

    await makeCmd().run();

    expect(selectAsync).toHaveBeenCalledWith(
      'Select an Expo SDK version',
      expect.arrayContaining([
        expect.objectContaining({ title: 'SDK 54', value: '54.0.0' }),
        expect.objectContaining({ title: 'SDK 55 (latest)', value: '55.0.0' }),
        expect.objectContaining({ title: 'SDK 56 (beta)', value: '56.0.0' }),
      ]),
      expect.objectContaining({ initial: '55.0.0' })
    );
  });

  it('skips prompt when all versions are deprecated', async () => {
    mockGetConfigFilePaths.mockReturnValue({ staticConfigPath: null, dynamicConfigPath: null });
    jest
      .mocked(WorkflowRunQuery.expoGoSupportedSdkVersionsAsync)
      .mockResolvedValue([
        { sdkVersion: '54.0.0', isLatest: false, isBeta: false, isDeprecated: true },
      ]);

    await makeCmd().run();

    expect(selectAsync).not.toHaveBeenCalled();
  });

  it('falls back gracefully when supportedSdkVersions fetch fails', async () => {
    mockGetConfigFilePaths.mockReturnValue({ staticConfigPath: null, dynamicConfigPath: null });
    jest
      .mocked(WorkflowRunQuery.expoGoSupportedSdkVersionsAsync)
      .mockRejectedValue(new Error('network error'));

    await makeCmd().run();

    expect(selectAsync).not.toHaveBeenCalled();
  });
});
