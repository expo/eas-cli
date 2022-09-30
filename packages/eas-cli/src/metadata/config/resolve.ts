import assert from 'assert';
import fs from 'fs-extra';
import path from 'path';

import { AppleConfigReader } from '../apple/config/reader';
import { AppleConfigWriter } from '../apple/config/writer';
import { MetadataValidationError } from '../errors';
import { MetadataConfig } from './schema';
import { validateConfig } from './validate';

/**
 * Resolve the dynamic config from the user.
 * It supports methods, async methods, or objects (json).
 */
async function resolveDynamicConfigAsync(configFile: string): Promise<unknown> {
  const userConfigOrFunction = await import(configFile).then(file => file.default ?? file);

  return typeof userConfigOrFunction === 'function'
    ? await userConfigOrFunction()
    : userConfigOrFunction;
}

/**
 * Get the static configuration file path, based on the metadata context.
 * This uses any custom name provided, but swaps out the extension for `.json`.
 */
export function getStaticConfigFilePath({
  projectDir,
  metadataPath,
}: {
  projectDir: string;
  metadataPath: string;
}): string {
  const configFile = path.join(projectDir, metadataPath);
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
  metadataPath,
  skipValidation = false,
}: {
  projectDir: string;
  metadataPath: string;
  skipValidation?: boolean;
}): Promise<MetadataConfig> {
  const configFile = path.join(projectDir, metadataPath);
  if (!(await fs.pathExists(configFile))) {
    throw new MetadataValidationError(`Metadata store config file not found: "${configFile}"`);
  }

  const configData = await resolveDynamicConfigAsync(configFile);

  if (!skipValidation) {
    const issues = validateConfig(configData);

    if (issues.length) {
      throw new MetadataValidationError(`Metadata store config errors found`, issues);
    }
  }

  return configData as MetadataConfig;
}

/** Create a versioned deserializer to fetch App Store data from the store configuration. */
export function createAppleReader(config: MetadataConfig): AppleConfigReader {
  assert(config.configVersion === 0, 'Unsupported store configuration version');
  assert(config.apple !== undefined, 'No apple configuration found');
  return new AppleConfigReader(config.apple!);
}

/** Create the serializer to write the App Store to the store configuration. */
export function createAppleWriter(): AppleConfigWriter {
  return new AppleConfigWriter();
}
