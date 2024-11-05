import ContextField, { ContextOptions } from './ContextField';
import { findProjectDirAndVerifyProjectSetupAsync } from './contextUtils/findProjectDirAndVerifyProjectSetupAsync';
import { getProjectIdAsync } from './contextUtils/getProjectIdAsync';
import { getPrivateExpoConfigAsync } from '../../project/expoConfig';

export class ProjectIdContextField extends ContextField<string> {
  async getValueAsync({ nonInteractive, sessionManager }: ContextOptions): Promise<string> {
    const projectDir = await findProjectDirAndVerifyProjectSetupAsync();
    const expBefore = await getPrivateExpoConfigAsync(projectDir);
    const projectId = await getProjectIdAsync(sessionManager, expBefore, {
      nonInteractive,
    });
    return projectId;
  }
}
