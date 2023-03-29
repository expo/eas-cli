import { ExpoConfig } from '@expo/config-types';

import { ExpoConfigOptions, getExpoConfig } from '../../project/expoConfig';
import ContextField, { ContextOptions } from './ContextField';
import { findProjectDirAndVerifyProjectSetupAsync } from './contextUtils/findProjectDirAndVerifyProjectSetupAsync';
import { getProjectIdAsync } from './contextUtils/getProjectIdAsync';

export type DynamicConfigContextFn = (options: ExpoConfigOptions) => Promise<{
  projectId: string;
  exp: ExpoConfig;
  projectDir: string;
}>;

export class DynamicProjectConfigContextField extends ContextField<DynamicConfigContextFn> {
  async getValueAsync({
    nonInteractive,
    sessionManager,
  }: ContextOptions): Promise<DynamicConfigContextFn> {
    const projectDir = await findProjectDirAndVerifyProjectSetupAsync();
    return async (options?: ExpoConfigOptions) => {
      const expBefore = getExpoConfig(projectDir, options);
      const projectId = await getProjectIdAsync(sessionManager, expBefore, {
        nonInteractive,
        env: options?.env,
      });
      const exp = getExpoConfig(projectDir, options);
      return {
        exp,
        projectDir,
        projectId,
      };
    };
  }
}
