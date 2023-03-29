import ContextField from './ContextField';
import {
  applyCliConfigAsync,
  findProjectDirAndVerifyProjectSetupAsync,
} from './contextUtils/findProjectDirAndVerifyProjectSetupAsync';

export default class ProjectDirContextField extends ContextField<string> {
  async getValueAsync(): Promise<string> {
    const projectDir = await findProjectDirAndVerifyProjectSetupAsync();
    await applyCliConfigAsync(projectDir);
    return projectDir;
  }
}
