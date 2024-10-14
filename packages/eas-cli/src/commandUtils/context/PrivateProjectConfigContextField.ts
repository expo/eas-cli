import { ExpoConfig } from '@expo/config';

import ContextField, { ContextOptions } from './ContextField';
import { findProjectDirAndVerifyProjectSetupAsync } from './contextUtils/findProjectDirAndVerifyProjectSetupAsync';
import { getProjectIdAsync } from './contextUtils/getProjectIdAsync';
import { getPrivateExpoConfigAsync } from '../../project/expoConfig';

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
    const expBefore = await getPrivateExpoConfigAsync(projectDir);
    const projectId = await getProjectIdAsync(sessionManager, expBefore, {
      nonInteractive,
    });
    const exp = await getPrivateExpoConfigAsync(projectDir);

    return {
      projectId,
      exp,
      projectDir,
    };
  }
}
