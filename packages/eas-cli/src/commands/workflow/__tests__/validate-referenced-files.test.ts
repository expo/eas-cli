import { Config } from '@oclif/core';
import { CombinedError } from '@urql/core';
import { GraphQLError } from 'graphql';

import { buildProfileNamesFromProjectAsync } from '../../../commandUtils/workflow/buildProfileUtils';
import { collectReferencedWorkflowFilesAsync } from '../../../commandUtils/workflow/referencedFiles';
import { WorkflowRevisionMutation } from '../../../graphql/mutations/WorkflowRevisionMutation';
import Log from '../../../log';
import { WorkflowFile } from '../../../utils/workflowFile';
import { WorkflowValidate } from '../validate';

jest.mock('../../../commandUtils/workflow/buildProfileUtils');
jest.mock('../../../commandUtils/workflow/compositeFunctions');
jest.mock('../../../commandUtils/workflow/referencedFiles');
jest.mock('../../../graphql/mutations/WorkflowRevisionMutation', () => {
  const actual = jest.requireActual('../../../graphql/mutations/WorkflowRevisionMutation');
  return {
    ...actual,
    WorkflowRevisionMutation: {
      ...actual.WorkflowRevisionMutation,
      validateWorkflowYamlConfigAsync: jest.fn(),
    },
  };
});
jest.mock('../../../utils/workflowFile', () => {
  const actual = jest.requireActual('../../../utils/workflowFile');
  return {
    ...actual,
    WorkflowFile: { ...actual.WorkflowFile, readWorkflowFileContentsAsync: jest.fn() },
  };
});
jest.mock('../../../ora', () => ({
  ora: () => {
    const spinner = { start: () => spinner, succeed: jest.fn(), fail: jest.fn() };
    return spinner;
  },
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

const mockCollectReferencedFiles = jest.mocked(collectReferencedWorkflowFilesAsync);
const mockValidate = jest.mocked(WorkflowRevisionMutation.validateWorkflowYamlConfigAsync);
const mockReadWorkflow = jest.mocked(WorkflowFile.readWorkflowFileContentsAsync);
const mockLogError = jest.mocked(Log.error);

const workflowSchema = {
  data: {
    type: 'object',
    properties: {
      jobs: {
        type: 'object',
        additionalProperties: {
          anyOf: [
            {
              type: 'object',
              properties: { type: { const: 'build' }, params: { type: 'object' } },
              required: ['type'],
            },
            { type: 'object', properties: { uses: { type: 'string' } }, required: ['uses'] },
          ],
        },
      },
    },
    required: ['jobs'],
  },
};

const callerYamlConfig = 'jobs:\n  ship:\n    uses: ./.eas/workflows/build.yml\n';
const plainYamlConfig = 'jobs:\n  build:\n    type: build\n';
const referencedFiles = [
  {
    fileName: 'build.yml',
    yamlConfig: 'on:\n  workflow_call: {}\njobs:\n  nested:\n    uses: ./.eas/workflows/test.yml\n',
  },
  { fileName: 'test.yml', yamlConfig: 'on:\n  workflow_call: {}\n' },
];

describe('WorkflowValidate referenced workflow files', () => {
  let mockConfig: Config;
  const fetchSpy = jest.spyOn(global, 'fetch');
  const initialSchemaPath = process.env.EXPO_TESTING_WORKFLOW_SCHEMA_PATH;

  beforeAll(async () => {
    mockConfig = new Config({ root: __dirname });
    mockConfig.runHook = async () => ({ failures: [], successes: [] });
  });

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.EXPO_TESTING_WORKFLOW_SCHEMA_PATH;
    process.exitCode = undefined;
    fetchSpy.mockImplementation(
      async () => new Response(JSON.stringify(workflowSchema), { status: 200 })
    );
    jest.mocked(buildProfileNamesFromProjectAsync).mockResolvedValue(new Set());
    mockValidate.mockResolvedValue(undefined as never);
    mockReadWorkflow.mockResolvedValue({
      filePath: '/test/project/.eas/workflows/caller.yml',
      yamlConfig: callerYamlConfig,
    } as never);
    mockCollectReferencedFiles.mockResolvedValue(referencedFiles);
  });

  afterAll(() => {
    process.env.EXPO_TESTING_WORKFLOW_SCHEMA_PATH = initialSchemaPath;
    fetchSpy.mockRestore();
  });

  function createCommand(): WorkflowValidate {
    const command = new WorkflowValidate(['.eas/workflows/caller.yml'], mockConfig);
    // @ts-expect-error getContextAsync is protected
    jest.spyOn(command, 'getContextAsync').mockResolvedValue({
      loggedIn: { graphqlClient: {} },
      projectDir: '/test/project',
      projectId: 'app-1',
    });
    return command;
  }

  it('sends the collected files, including nested callees, to validation', async () => {
    await createCommand().runAsync();

    expect(mockCollectReferencedFiles).toHaveBeenCalledWith({
      projectDir: '/test/project',
      rootFileName: 'caller.yml',
      rootYamlConfig: callerYamlConfig,
    });
    expect(mockValidate).toHaveBeenCalledWith(
      {},
      { appId: 'app-1', yamlConfig: callerYamlConfig, referencedFiles }
    );
    expect(process.exitCode).toBeUndefined();
  });

  it('sends an empty list when the workflow calls no other workflow', async () => {
    mockReadWorkflow.mockResolvedValue({
      filePath: '/test/project/.eas/workflows/plain.yml',
      yamlConfig: plainYamlConfig,
    } as never);
    mockCollectReferencedFiles.mockResolvedValue([]);

    await createCommand().runAsync();

    expect(mockValidate).toHaveBeenCalledWith(
      {},
      { appId: 'app-1', yamlConfig: plainYamlConfig, referencedFiles: [] }
    );
    expect(process.exitCode).toBeUndefined();
  });

  it('fails with the collector error when a called file is missing', async () => {
    const message =
      'Job "ship" in caller.yml uses ./.eas/workflows/build.yml, but /test/project/.eas/workflows/build.yml does not exist.';
    mockCollectReferencedFiles.mockRejectedValue(new Error(message));

    await createCommand().runAsync();

    expect(mockValidate).not.toHaveBeenCalled();
    expect(mockLogError).toHaveBeenCalledWith(`Error: ${message}`);
    expect(process.exitCode).toBe(1);
  });

  it('reports server validation errors for a called file', async () => {
    const error = new CombinedError({
      graphQLErrors: [
        new GraphQLError('Validation failed', {
          extensions: {
            errorCode: 'VALIDATION_ERROR',
            metadata: {
              formErrors: ['build.yml: Workflow must declare on.workflow_call'],
              fieldErrors: {},
            },
          },
        }),
      ],
    });
    mockValidate.mockRejectedValue(error);

    await expect(createCommand().runAsync()).rejects.toBe(error);

    expect(mockLogError).toHaveBeenCalledWith('Workflow file is invalid. Issues:');
    expect(mockLogError).toHaveBeenCalledWith(
      '- build.yml: Workflow must declare on.workflow_call'
    );
    expect(process.exitCode).toBe(1);
  });
});
