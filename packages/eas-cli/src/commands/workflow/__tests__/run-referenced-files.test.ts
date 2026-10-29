import spawnAsync from '@expo/spawn-async';
import { Config } from '@oclif/core';

import { collectReferencedWorkflowFilesAsync } from '../../../commandUtils/workflow/referencedFiles';
import { fileExistsAsync, maybeReadStdinAsync } from '../../../commandUtils/workflow/utils';
import { WorkflowRevisionMutation } from '../../../graphql/mutations/WorkflowRevisionMutation';
import { WorkflowRunMutation } from '../../../graphql/mutations/WorkflowRunMutation';
import { getOwnerAccountForProjectIdAsync } from '../../../project/projectUtils';
import { uploadAccountScopedFileAsync } from '../../../project/uploadAccountScopedFileAsync';
import { uploadAccountScopedProjectSourceAsync } from '../../../project/uploadAccountScopedProjectSourceAsync';
import { WorkflowFile } from '../../../utils/workflowFile';
import WorkflowRun from '../run';

jest.mock('@expo/spawn-async', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('../../../commandUtils/workflow/referencedFiles');
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
const mockCollectReferencedFiles = jest.mocked(collectReferencedWorkflowFilesAsync);
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

const rootYamlConfig = 'jobs:\n  ship:\n    uses: ./.eas/workflows/build.yml\n';
const referencedFiles = [{ fileName: 'build.yml', yamlConfig: 'on:\n  workflow_call: {}\n' }];

describe('WorkflowRun referenced workflow files', () => {
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
      filePath: '/test/project/.eas/workflows/test.yml',
      yamlConfig: rootYamlConfig,
    } as never);
    mockCollectReferencedFiles.mockResolvedValue(referencedFiles);
    mockFileExists.mockResolvedValue(false);
    mockUploadProject.mockResolvedValue({ projectArchiveBucketKey: 'archive-key' } as never);
    mockUploadFile.mockResolvedValue({ fileBucketKey: 'file-key' } as never);
    mockCreateRun.mockResolvedValue({ id: 'run-1' } as never);
    mockCreateFromGitRef.mockResolvedValue({ id: 'run-git-1' } as never);
    mockSpawn.mockResolvedValue({ output: ['abc123\n'] } as never);
    mockGetOrCreateRevision.mockResolvedValue({ id: 'rev-1', yamlConfig: rootYamlConfig } as never);
  });

  afterEach(() => {
    exitSpy.mockRestore();
  });

  function createCommand(flags: { ref?: string }): WorkflowRun {
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
        ssh: false,
        'ssh-idle-timeout': undefined,
      },
      args: { file: '.eas/workflows/test.yml' },
    });
    return command;
  }

  it('sends the collected files to validation and to the run creation', async () => {
    await expect(createCommand({}).runAsync()).rejects.toThrow('process.exit:0');

    expect(mockCollectReferencedFiles).toHaveBeenCalledWith({
      projectDir: '/test/project',
      rootFileName: 'test.yml',
      rootYamlConfig,
    });
    expect(mockValidate).toHaveBeenCalledWith(
      {},
      { appId: 'app-1', yamlConfig: rootYamlConfig, referencedFiles }
    );
    expect(mockCreateRun).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        workflowRevisionInput: {
          fileName: 'test.yml',
          yamlConfig: rootYamlConfig,
          referencedFiles,
        },
      })
    );
  });

  it('fails before validation and upload when the collector throws', async () => {
    mockCollectReferencedFiles.mockRejectedValue(new Error('build.yml does not exist.'));

    await expect(createCommand({}).runAsync()).rejects.toThrow('build.yml does not exist.');

    expect(mockValidate).not.toHaveBeenCalled();
    expect(mockUploadProject).not.toHaveBeenCalled();
    expect(mockCreateRun).not.toHaveBeenCalled();
  });

  it('does not collect local files when --ref is set', async () => {
    await expect(createCommand({ ref: 'main' }).runAsync()).rejects.toThrow('process.exit:0');

    expect(mockCollectReferencedFiles).not.toHaveBeenCalled();
    expect(mockValidate).toHaveBeenCalledWith(
      {},
      { appId: 'app-1', yamlConfig: rootYamlConfig, referencedFiles: undefined }
    );
    expect(mockCreateFromGitRef).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ workflowRevisionId: 'rev-1', gitRef: 'abc123' })
    );
    expect(mockCreateRun).not.toHaveBeenCalled();
  });
});
