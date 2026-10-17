import { MissingEasJsonError } from '@expo/eas-json/build/errors';

import { mockCommandContext, mockProjectId, mockTestCommand } from './utils';
import { validateWorkflowFileAsync } from '../../commandUtils/workflow/validation';
import { WorkflowValidate } from '../../commands/workflow/validate';
import { WorkflowFile } from '../../utils/workflowFile';

jest.mock('../../commandUtils/workflow/validation', () => ({
  ...jest.requireActual('../../commandUtils/workflow/validation'),
  validateWorkflowFileAsync: jest.fn(),
}));
jest.mock('../../utils/workflowFile');
jest.mock('fs');
jest.mock('../../log');
jest.mock('../../ora', () => ({
  ora: () => ({ start: () => ({ succeed: jest.fn(), fail: jest.fn() }) }),
}));

describe(WorkflowValidate, () => {
  const initialExitCode = process.exitCode;

  beforeEach(() => {
    jest.mocked(WorkflowFile.readWorkflowFileContentsAsync).mockResolvedValue({
      yamlConfig: 'jobs: {}',
      filePath: '.eas/workflows/test.yml',
    });
  });

  afterEach(() => {
    process.exitCode = initialExitCode;
    jest.clearAllMocks();
  });

  it('leaves the exit code unset when the workflow is valid', async () => {
    jest.mocked(validateWorkflowFileAsync).mockResolvedValue();
    const ctx = mockCommandContext(WorkflowValidate, { projectId: mockProjectId });

    await mockTestCommand(WorkflowValidate, ['.eas/workflows/test.yml'], ctx).run();

    expect(process.exitCode).toBe(initialExitCode);
  });

  it('sets a non-zero exit code when the workflow is invalid', async () => {
    jest.mocked(validateWorkflowFileAsync).mockRejectedValue(new Error('invalid job'));
    const ctx = mockCommandContext(WorkflowValidate, { projectId: mockProjectId });

    await mockTestCommand(WorkflowValidate, ['.eas/workflows/test.yml'], ctx).run();

    expect(process.exitCode).toBe(1);
  });

  it('sets a non-zero exit code when a validation error is rethrown', async () => {
    jest.mocked(validateWorkflowFileAsync).mockRejectedValue(new MissingEasJsonError('missing'));
    const ctx = mockCommandContext(WorkflowValidate, { projectId: mockProjectId });

    await expect(
      mockTestCommand(WorkflowValidate, ['.eas/workflows/test.yml'], ctx).run()
    ).rejects.toThrow('Workflows require a valid eas.json');
    expect(process.exitCode).toBe(1);
  });
});
