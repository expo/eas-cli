import { Platform } from '@expo/eas-build-job';
import fs from 'fs-extra';
import path from 'path';

import {
  AndroidBuildProfile,
  BuildProfile,
  EasConfig,
  Workflow,
  iOSBuildProfile,
} from './Config.types';
import { EasJsonSchema, schemaBuildProfileMap } from './EasJsonSchema';

interface EasJson {
  builds: {
    android?: { [key: string]: AndroidBuildProfile };
    ios?: { [key: string]: iOSBuildProfile };
  };
}

interface BuildProfilePreValidation {
  workflow: Workflow;
}

export class EasJsonReader {
  constructor(private projectDir: string, private platform: 'android' | 'ios' | 'all') {}

  public async readAsync(buildProfileName: string): Promise<EasConfig> {
    const easJson = await this.readFile();

    let androidConfig;
    if (['android', 'all'].includes(this.platform)) {
      androidConfig = this.validateBuildProfile<AndroidBuildProfile>(
        Platform.Android,
        buildProfileName,
        easJson.builds?.android?.[buildProfileName]
      );
    }
    let iosConfig;
    if (['ios', 'all'].includes(this.platform)) {
      iosConfig = this.validateBuildProfile<iOSBuildProfile>(
        Platform.iOS,
        buildProfileName,
        easJson.builds?.ios?.[buildProfileName]
      );
    }
    return {
      builds: {
        ...(androidConfig ? { android: androidConfig } : {}),
        ...(iosConfig ? { ios: iosConfig } : {}),
      },
    };
  }

  private validateBuildProfile<T extends BuildProfile>(
    platform: 'android' | 'ios' | 'all',
    buildProfileName: string,
    buildProfile?: BuildProfilePreValidation
  ): T {
    if (!buildProfile) {
      throw new Error(`There is no profile named ${buildProfileName} for platform ${platform}`);
    }
    const schema = schemaBuildProfileMap[platform][buildProfile?.workflow];
    if (!schema) {
      throw new Error('invalid workflow'); // this should be validated earlier
    }
    const { value, error } = schema.validate(buildProfile, {
      stripUnknown: true,
      convert: true,
      abortEarly: false,
    });

    if (error) {
      throw new Error(
        `Object "${platform}.${buildProfileName}" in eas.json is not valid [${error.toString()}]`
      );
    }
    return value;
  }

  private async readFile(): Promise<EasJson> {
    const rawFile = await fs.readFile(path.join(this.projectDir, 'eas.json'), 'utf-8');
    const json = JSON.parse(rawFile);

    const { value, error } = EasJsonSchema.validate(json, {
      abortEarly: false,
    });

    if (error) {
      throw new Error(`eas.json is not valid [${error.toString()}]`);
    }
    return value;
  }
}
