import spawnAsync from '@expo/spawn-async';
import { Config } from '@oclif/core';

import { fileExistsAsync, maybeReadStdinAsync } from '../../../commandUtils/workflow/utils';
import { WorkflowRevisionMutation } from '../../../graphql/mutations/WorkflowRevisionMutation';
import { WorkflowRunMutation } from '../../../graphql/mutations/WorkflowRunMutation';
import Log from '../../../log';
import { getOwnerAccountForProjectIdAsync } from '../../../project/projectUtils';
import { uploadAccountScopedFileAsync } from '../../../project/uploadAccountScopedFileAsync';
import { uploadAccountScopedProjectSourceAsync } from '../../../project/uploadAccountScopedProjectSourceAsync';
import { WorkflowFile } from '../../../utils/workflowFile';
import WorkflowRun from '../run';

jest.mock('@expo/spawn-async', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('../../../graphql/mutations/WorkflowRevisionMutation');
jest.mock('../../../graphql/mutations/WorkflowRunMutation');
jest.mock('../../../project/projectUtils');
jest.mock('../../../project/uploadAccountScopedFileAsync');
jest.mock('../../../project/uploadAccountScopedProjectSourceAsync');
jest.mock('../../../utils/workflowFile');
jest.mock('../../../commandUtils/workflow/utils', () => ({
  ...jest.requireActual('../../../commandUtils/workflow/utils'),
  fileExistsAsync: jest.fn(),
  maybeReadStdinAsync: jest.fn(),
}));
jest.mock('../../../log', () => ({
  __esModule: true,
  default: {
    log: jest.fn(),
    newLine: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
  link: jest.fn((url: string) => url),
}));

const mockSpawn = jest.mocked(spawnAsync);
const mockValidate = jest.mocked(WorkflowRevisionMutation.validateWorkflowYamlConfigAsync);
const mockGetOrCreateRevision = jest.mocked(
  WorkflowRevisionMutation.getOrCreateWorkflowRevisionFromGitRefAsync
);
const mockCreateFromGitRef = jest.mocked(WorkflowRunMutation.createWorkflowRunFromGitRefAsync);
const mockCreateRun = jest.mocked(WorkflowRunMutation.createWorkflowRunAsync);
const mockGetOwner = jest.mocked(getOwnerAccountForProjectIdAsync);
const mockUploadProject = jest.mocked(uploadAccountScopedProjectSourceAsync);
const mockUploadFile = jest.mocked(uploadAccountScopedFileAsync);
const mockReadWorkflow = jest.mocked(WorkflowFile.readWorkflowFileContentsAsync);
const mockFileExists = jest.mocked(fileExistsAsync);
const mockReadStdin = jest.mocked(maybeReadStdinAsync);

describe('WorkflowRun --ssh', () => {
  let mockConfig: Config;
  let exitSpy: jest.SpyInstance;

  beforeAll(async () => {
    mockConfig = new Config({ root: __dirname });
    mockConfig.runHook = async () => ({ failures: [], successes: [] });
  });

  beforeEach(() => {
    jest.clearAllMocks();
    exitSpy = jest.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit:${code ?? 0}`);
    }) as never);
    mockReadStdin.mockResolvedValue(null);
    mockGetOwner.mockResolvedValue({ id: 'acct-1', name: 'testuser' } as never);
    mockValidate.mockResolvedValue(undefined as never);
    mockReadWorkflow.mockResolvedValue({
      filePath: '.eas/workflows/test.yml',
      yamlConfig: 'jobs:\n  a:\n    steps: []\n',
    } as never);
    mockFileExists.mockResolvedValue(false);
    mockUploadProject.mockResolvedValue({ projectArchiveBucketKey: 'archive-key' } as never);
    mockUploadFile.mockResolvedValue({ fileBucketKey: 'file-key' } as never);
    mockCreateRun.mockResolvedValue({ id: 'run-1' } as never);
    mockCreateFromGitRef.mockResolvedValue({ id: 'run-git-1' } as never);
    mockSpawn.mockResolvedValue({ output: ['abc123\n'] } as never);
    mockGetOrCreateRevision.mockResolvedValue({
      id: 'rev-1',
      yamlConfig: 'jobs:\n  a:\n    steps: []\n',
    } as never);
  });

  afterEach(() => {
    exitSpy.mockRestore();
  });

  function createCommand(flags: {
    ssh?: boolean;
    'ssh-idle-timeout'?: number;
    ref?: string;
  }): WorkflowRun {
    const command = new WorkflowRun(['.eas/workflows/test.yml'], mockConfig);
    // @ts-expect-error getContextAsync/parse are protected
    jest.spyOn(command, 'getContextAsync').mockResolvedValue({
      getDynamicPrivateProjectConfigAsync: async () => ({
        projectId: 'app-1',
        exp: { slug: 'testapp' },
      }),
      loggedIn: { graphqlClient: {} },
      vcsClient: { getRootPathAsync: async () => '/test/project' },
      projectDir: '/test/project',
    });
    // @ts-expect-error parse is protected on the oclif base
    jest.spyOn(command, 'parse').mockResolvedValue({
      flags: {
        json: false,
        wait: false,
        'non-interactive': true,
        input: undefined,
        ref: flags.ref,
        ssh: flags.ssh ?? false,
        'ssh-idle-timeout': flags['ssh-idle-timeout'],
      },
      args: { file: '.eas/workflows/test.yml' },
    });
    return command;
  }

  it('passes ssh input into createWorkflowRunAsync and logs that SSH is enabled', async () => {
    await expect(createCommand({ ssh: true, 'ssh-idle-timeout': 120 }).runAsync()).rejects.toThrow(
      'process.exit:0'
    );

    expect(mockCreateRun).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        workflowRunInput: expect.objectContaining({
          ssh: { idleTimeoutSeconds: 120 },
        }),
      })
    );
    expect(Log.log).toHaveBeenCalledWith(
      'SSH enabled. Each VM job logs the `eas workflow:ssh` command to connect.'
    );
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('does not log the SSH banner when --ssh is unset', async () => {
    await expect(createCommand({ ssh: false }).runAsync()).rejects.toThrow('process.exit:0');

    expect(mockCreateRun).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        workflowRunInput: expect.objectContaining({
          ssh: null,
        }),
      })
    );
    expect(Log.log).not.toHaveBeenCalledWith(
      'SSH enabled. Each VM job logs the `eas workflow:ssh` command to connect.'
    );
  });

  it('passes ssh input into createWorkflowRunFromGitRefAsync when --ref is set', async () => {
    await expect(createCommand({ ssh: true, ref: 'main' }).runAsync()).rejects.toThrow(
      'process.exit:0'
    );

    expect(mockCreateFromGitRef).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        ssh: { idleTimeoutSeconds: undefined },
      })
    );
    expect(Log.log).toHaveBeenCalledWith(
      'SSH enabled. Each VM job logs the `eas workflow:ssh` command to connect.'
    );
  });
});
