import { SubmitProfile } from '@expo/eas-json';
import assert from 'assert';
import fs from 'fs-extra';
import path from 'path';

import { MetadataConfig } from './schema';
import { validateConfig } from './validate';
import { AppleConfigReader } from '../apple/config/reader';
import { AppleConfigWriter } from '../apple/config/writer';
import { MetadataValidationError } from '../errors';

/**
 * Resolve the dynamic config from the user.
 * It supports methods, async methods, or objects (json).
 */
async function resolveDynamicConfigAsync(configFile: string): Promise<unknown> {
  const userConfigOrFunction = await import(configFile).then(file => file.default ?? file);

  return typeof userConfigOrFunction === 'function'
    ? // eslint-disable-next-line @typescript-eslint/return-await
      await userConfigOrFunction()
    : userConfigOrFunction;
}

/**
 * Resolve the prefered store config file name from the submit profile.
 * This is relative to the project directory, and uses `store.config.json` by default.
 */
function resolveConfigFilePath(profile: SubmitProfile): string {
  if ('metadataPath' in profile) {
    return profile.metadataPath ?? 'store.config.json';
  }

  return 'store.config.json';
}

/**
 * Get the static configuration file path, based on the metadata context.
 * This uses any custom name provided, but swaps out the extension for `.json`.
 */
export function getStaticConfigFilePath({
  projectDir,
  profile,
}: {
  projectDir: string;
  profile: SubmitProfile;
}): string {
  const configFile = path.join(projectDir, resolveConfigFilePath(profile));
  const configExtension = path.extname(configFile);

  return path.join(projectDir, `${path.basename(configFile, configExtension)}.json`);
}

/**
 * Load the store configuration from a metadata context.
 * This can load `.json` and `.js` config files, using `require`.
 * It throws MetadataValidationErrors when the file doesn't exist, or contains errors.
 * The user is prompted to try anyway when errors are found.
 */
export async function loadConfigAsync({
  projectDir,
  profile,
  skipValidation = false,
}: {
  projectDir: string;
  profile: SubmitProfile;
  skipValidation?: boolean;
}): Promise<MetadataConfig> {
  const configFile = path.join(projectDir, resolveConfigFilePath(profile));
  if (!(await fs.pathExists(configFile))) {
    throw new MetadataValidationError(`Metadata store config file not found: "${configFile}"`);
  }

  const configData = await resolveDynamicConfigAsync(configFile);

  if (!skipValidation) {
    const issues = validateConfig(configData);

    if (issues.length > 0) {
      throw new MetadataValidationError(`Metadata store config errors found`, issues);
    }
  }

  return configData as MetadataConfig;
}

/** Create a versioned deserializer to fetch App Store data from the store configuration. */
export function createAppleReader(config: MetadataConfig): AppleConfigReader {
  assert(config.configVersion === 0, 'Unsupported store configuration version');
  assert(config.apple !== undefined, 'No apple configuration found');
  return new AppleConfigReader(config.apple);
}

/** Create the serializer to write the App Store to the store configuration. */
export function createAppleWriter(): AppleConfigWriter {
  return new AppleConfigWriter();
}
