import { ExpoConfig } from '@expo/config-types';
import { InvalidEasJsonError } from '@expo/eas-json/build/errors';

import ContextField, { ContextOptions } from './ContextField';
import { findProjectDirAndVerifyProjectSetupAsync } from './contextUtils/findProjectDirAndVerifyProjectSetupAsync';
import { getProjectIdAsync } from './contextUtils/getProjectIdAsync';
import { getPrivateExpoConfig } from '../../project/expoConfig';

export class OptionalPrivateProjectConfigContextField extends ContextField<
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

    const expBefore = getPrivateExpoConfig(projectDir);
    const projectId = await getProjectIdAsync(sessionManager, expBefore, {
      nonInteractive,
    });
    const exp = getPrivateExpoConfig(projectDir);
    return {
      exp,
      projectDir,
      projectId,
    };
  }
}
