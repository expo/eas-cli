import { ExpoConfig } from '@expo/config-types';

import { getExpoConfig } from '../../project/expoConfig';
import ContextField, { ContextOptions } from './ContextField';
import { findProjectDirAndVerifyProjectSetupAsync } from './contextUtils/findProjectDirAndVerifyProjectSetupAsync';
import { getProjectIdAsync } from './contextUtils/getProjectIdAsync';

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
      projectDir = await findProjectDirAndVerifyProjectSetupAsync();
      if (!projectDir) {
        return undefined;
      }
    } catch {
      return undefined;
    }

    const expBefore = getExpoConfig(projectDir);
    const projectId = await getProjectIdAsync(expBefore, {
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
