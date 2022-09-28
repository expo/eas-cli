import { ExpoConfig } from '@expo/config-types';

import { ExpoConfigOptions, getExpoConfig } from '../../project/expoConfig';
import ContextField, { ContextOptions } from './ContextField';
import ProjectConfigContextField from './ProjectConfigContextField';
import ProjectDirContextField from './ProjectDirContextField';

export type DynamicConfigContextFn = (options?: ExpoConfigOptions) => Promise<{
  projectId: string;
  exp: ExpoConfig;
  projectDir: string;
}>;

export class DynamicProjectConfigContextField extends ContextField<DynamicConfigContextFn> {
  async getValueAsync({ nonInteractive }: ContextOptions): Promise<DynamicConfigContextFn> {
    return async (options?: ExpoConfigOptions) => {
      const projectDir = await ProjectDirContextField['findProjectDirAndVerifyProjectSetupAsync']();
      const expBefore = getExpoConfig(projectDir, options);
      const projectId = await ProjectConfigContextField['getProjectIdAsync'](expBefore, {
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
