import { ExpoConfig } from '@expo/config-types';

import { getExpoConfig } from '../../project/expoConfig';
import ContextField, { ContextOptions } from './ContextField';
import ProjectConfigContextField from './ProjectConfigContextField';
import ProjectDirContextField from './ProjectDirContextField';

export class OptionalProjectConfigContextField extends ContextField<
  | {
      projectId: string;
      exp: ExpoConfig;
      projectDir: string;
    }
  | undefined
> {
  async getValueAsync({ nonInteractive }: ContextOptions): Promise<
    | {
        projectId: string;
        exp: ExpoConfig;
        projectDir: string;
      }
    | undefined
  > {
    let projectDir: string;
    try {
      projectDir = await ProjectDirContextField['findProjectDirAndVerifyProjectSetupAsync']();
      if (!projectDir) {
        return undefined;
      }
    } catch {
      return undefined;
    }

    const expBefore = getExpoConfig(projectDir);
    const projectId = await ProjectConfigContextField['getProjectIdAsync'](expBefore, {
      nonInteractive,
    });
    const exp = getExpoConfig(projectDir);
    return {
      exp,
      projectDir,
      projectId,
    };
  }
}
