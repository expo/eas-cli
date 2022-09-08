import { Platform } from '@expo/eas-build-job';

import { EasJsonAccessor } from './accessor';
import { resolveBuildProfile } from './build/resolver';
import { BuildProfile } from './build/types';
import { MissingEasJsonError } from './errors';
import { resolveSubmitProfile } from './submit/resolver';
import { SubmitProfile } from './submit/types';
import { EasJson } from './types';

export class EasJsonUtils {
  constructor(private accessor: EasJsonAccessor) {}

  public async getBuildProfileNamesAsync(): Promise<string[]> {
    const easJson = await this.accessor.readAsync();
    return Object.keys(easJson?.build ?? {});
  }

  public async getBuildProfileAsync<T extends Platform>(
    platform: T,
    profileName?: string
  ): Promise<BuildProfile<T>> {
    const easJson = await this.accessor.readAsync();
    return resolveBuildProfile({ easJson, platform, profileName });
  }

  public async getCliConfigAsync(): Promise<EasJson['cli'] | null> {
    try {
      const easJson = await this.accessor.readAsync();
      return easJson.cli ?? null;
    } catch (err: any) {
      if (err instanceof MissingEasJsonError) {
        return null;
      }
      throw err;
    }
  }

  public async getSubmitProfileNamesAsync(): Promise<string[]> {
    const easJson = await this.accessor.readAsync();
    return Object.keys(easJson?.submit ?? {});
  }

  public async getSubmitProfileAsync<T extends Platform>(
    platform: T,
    profileName?: string
  ): Promise<SubmitProfile<T>> {
    const easJson = await this.accessor.readAsync();
    return resolveSubmitProfile({ easJson, platform, profileName });
  }
}
