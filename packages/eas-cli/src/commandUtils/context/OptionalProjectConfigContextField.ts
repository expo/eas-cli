import { ExpoConfig } from '@expo/config-types';
import { InvalidEasJsonError } from '@expo/eas-json/build/errors';

import { getExpoConfig } from '../../project/expoConfig';
import ContextField, { ContextOptions } from './ContextField';
import { applyCliConfigAsync, findProjectDirAndVerifyProjectSetupAsync } from './contextUtils/findProjectDirAndVerifyProjectSetupAsync';
import { getProjectIdAsync } from './contextUtils/getProjectIdAsync';

export class OptionalProjectConfigContextField extends ContextField<
  | {
      projectId: string;
      exp: ExpoConfig;
      projectDir: string;
    }
  | undefined
> {
  async getValueAsync({ nonInteractive, sessionManager }: ContextOptions): Promise<
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
    } catch (e) {
      if (e instanceof InvalidEasJsonError) {
        throw e;
      }
      return undefined;
    }

    await applyCliConfigAsync(projectDir);
    const expBefore = getExpoConfig(projectDir);
    const projectId = await getProjectIdAsync(sessionManager, expBefore, {
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
