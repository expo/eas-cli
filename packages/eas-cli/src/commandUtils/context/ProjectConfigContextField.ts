import { ExpoConfig } from '@expo/config-types';

import { getExpoConfig } from '../../project/expoConfig';
import ContextField, { ContextOptions } from './ContextField';
import { findProjectDirAndVerifyProjectSetupAsync } from './contextUtils/findProjectDirAndVerifyProjectSetupAsync';
import { getProjectIdAsync } from './contextUtils/getProjectIdAsync';

export default class ProjectConfigContextField extends ContextField<{
  projectId: string;
  exp: ExpoConfig;
  projectDir: string;
}> {
  async getValueAsync({ nonInteractive, sessionManager }: ContextOptions): Promise<{
    projectId: string;
    exp: ExpoConfig;
    projectDir: string;
  }> {
    const projectDir = await findProjectDirAndVerifyProjectSetupAsync();
    const expBefore = getExpoConfig(projectDir);
    const projectId = await getProjectIdAsync(sessionManager, expBefore, {
      nonInteractive,
    });
    const exp = getExpoConfig(projectDir);

    return {
      projectId,
      exp,
      projectDir,
    };
  }
}
