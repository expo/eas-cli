import { Config } from '@oclif/core';

import { fileExistsAsync, maybeReadStdinAsync } from '../../../commandUtils/workflow/utils';
import { WorkflowRevisionMutation } from '../../../graphql/mutations/WorkflowRevisionMutation';
import { WorkflowRunMutation } from '../../../graphql/mutations/WorkflowRunMutation';
import { getOwnerAccountForProjectIdAsync } from '../../../project/projectUtils';
import { uploadAccountScopedFileAsync } from '../../../project/uploadAccountScopedFileAsync';
import { uploadAccountScopedProjectSourceAsync } from '../../../project/uploadAccountScopedProjectSourceAsync';
import { WorkflowFile } from '../../../utils/workflowFile';
import WorkflowRun from '../run';

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

const mockValidate = jest.mocked(WorkflowRevisionMutation.validateWorkflowYamlConfigAsync);
const mockCreateRun = jest.mocked(WorkflowRunMutation.createWorkflowRunAsync);
const mockGetOwner = jest.mocked(getOwnerAccountForProjectIdAsync);
const mockUploadProject = jest.mocked(uploadAccountScopedProjectSourceAsync);
const mockUploadFile = jest.mocked(uploadAccountScopedFileAsync);
const mockReadWorkflow = jest.mocked(WorkflowFile.readWorkflowFileContentsAsync);
const mockFileExists = jest.mocked(fileExistsAsync);
const mockReadStdin = jest.mocked(maybeReadStdinAsync);

describe('WorkflowRun --git-branch and --git-commit-hash', () => {
  const commitHash = '1234567890abcdef1234567890abcdef12345678';
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
  });

  afterEach(() => {
    exitSpy.mockRestore();
  });

  function createCommand(flags: {
    'git-branch'?: string;
    'git-commit-hash'?: string;
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
        ref: undefined,
        ssh: false,
        'ssh-idle-timeout': undefined,
        'git-branch': flags['git-branch'],
        'git-commit-hash': flags['git-commit-hash'],
      },
      args: { file: '.eas/workflows/test.yml' },
    });
    return command;
  }

  it('passes the branch and commit hash into createWorkflowRunAsync', async () => {
    await expect(
      createCommand({ 'git-branch': 'feature/foo', 'git-commit-hash': commitHash }).runAsync()
    ).rejects.toThrow('process.exit:0');

    expect(mockCreateRun).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        workflowRunInput: expect.objectContaining({
          git: { branch: 'feature/foo', commitHash },
        }),
      })
    );
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('leaves git undefined when the flags are unset', async () => {
    await expect(createCommand({}).runAsync()).rejects.toThrow('process.exit:0');

    expect(mockCreateRun).toHaveBeenCalledTimes(1);
    expect(mockCreateRun.mock.calls[0][1].workflowRunInput.git).toBeUndefined();
  });
});
