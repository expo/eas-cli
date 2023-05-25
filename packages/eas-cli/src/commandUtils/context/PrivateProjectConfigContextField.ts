import { ExpoConfig } from '@expo/config-types';

import { getPrivateExpoConfig } from '../../project/expoConfig';
import ContextField, { ContextOptions } from './ContextField';
import { findProjectDirAndVerifyProjectSetupAsync } from './contextUtils/findProjectDirAndVerifyProjectSetupAsync';
import { getProjectIdAsync } from './contextUtils/getProjectIdAsync';

export class PrivateProjectConfigContextField extends ContextField<{
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
    const expBefore = getPrivateExpoConfig(projectDir);
    const projectId = await getProjectIdAsync(sessionManager, expBefore, {
      nonInteractive,
    });
    const exp = getPrivateExpoConfig(projectDir);

    return {
      projectId,
      exp,
      projectDir,
    };
  }
}
