import { ContextOptions } from '../ContextField';
import { ProjectIdContextField } from '../ProjectIdContextField';
import { findProjectDirAndVerifyProjectSetupAsync } from '../contextUtils/findProjectDirAndVerifyProjectSetupAsync';

jest.mock('../contextUtils/findProjectDirAndVerifyProjectSetupAsync');

describe(ProjectIdContextField, () => {
  it('returns the override without reading the project directory', async () => {
    const projectId = await new ProjectIdContextField().getValueAsync({
      projectIdOverride: 'override-project-id',
    } as ContextOptions);

    expect(projectId).toBe('override-project-id');
    expect(findProjectDirAndVerifyProjectSetupAsync).not.toHaveBeenCalled();
  });
});
