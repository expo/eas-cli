import { Platform } from '@expo/eas-build-job';
import JsonFile from '@expo/json-file';
import fs from 'fs-extra';
import path from 'path';

import { resolveBuildProfile } from './build/resolver';
import { BuildProfile } from './build/types';
import { InvalidEasJsonError, MissingEasJsonError } from './errors';
import { EasJsonSchema } from './schema';
import { resolveSubmitProfile } from './submit/resolver';
import { SubmitProfile } from './submit/types';
import { EasJson } from './types';

export class EasJsonReader {
  private easJson: EasJson | undefined;

  constructor(private projectDir: string) {}

  public static formatEasJsonPath(projectDir: string): string {
    return path.join(projectDir, 'eas.json');
  }

  public async readAsync(): Promise<EasJson> {
    if (this.easJson) {
      return this.easJson;
    }

    try {
      const easJsonPath = EasJsonReader.formatEasJsonPath(this.projectDir);
      if (!(await fs.pathExists(easJsonPath))) {
        throw new MissingEasJsonError(
          `eas.json could not be found at ${easJsonPath}. Learn more at https://expo.fyi/eas-json`
        );
      }
      const contents = JsonFile.read(easJsonPath);
      const { value, error } = EasJsonSchema.validate(contents, {
        allowUnknown: false,
        abortEarly: false,
        convert: true,
        noDefaults: true,
      });
      if (error) {
        throw new InvalidEasJsonError(`eas.json is not valid [${error.toString()}]`);
      }
      this.easJson = value;
      return value;
    } catch (err: any) {
      if (err.code === 'EJSONPARSE') {
        err.message = `Found invalid JSON in eas.json. ${err.message}`;
      }
      throw err;
    }
  }

  public async getBuildProfileNamesAsync(): Promise<string[]> {
    const easJson = await this.readAsync();
    return Object.keys(easJson?.build ?? {});
  }

  public async getBuildProfileAsync<T extends Platform>(
    platform: T,
    profileName: string
  ): Promise<BuildProfile<T>> {
    const easJson = await this.readAsync();
    return resolveBuildProfile({ easJson, platform, profileName });
  }

  public async getCliConfigAsync(): Promise<EasJson['cli'] | null> {
    try {
      const easJson = await this.readAsync();
      return easJson.cli ?? null;
    } catch (err: any) {
      if (err instanceof MissingEasJsonError) {
        return null;
      }
      throw err;
    }
  }

  public async getSubmitProfileNamesAsync(): Promise<string[]> {
    const easJson = await this.readAsync();
    return Object.keys(easJson?.submit ?? {});
  }

  public async getSubmitProfileAsync<T extends Platform>(
    platform: T,
    profileName: string
  ): Promise<SubmitProfile<T>> {
    const easJson = await this.readAsync();
    return resolveSubmitProfile({ easJson, platform, profileName });
  }
}
