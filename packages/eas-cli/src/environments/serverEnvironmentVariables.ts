import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import { EnvironmentSecretType } from '../graphql/generated';
import { EnvironmentVariablesQuery } from '../graphql/queries/EnvironmentVariablesQuery';

let secretsDirectory: string | undefined;

function getSecretsDirectory(): string {
  if (!secretsDirectory) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'eas-environment-secrets-'));
    // Keep the files for the whole command: `eas build --local` hands this env to the
    // local build plugin, which runs prebuild long after the config was evaluated.
    process.once('exit', () => {
      fs.rmSync(directory, { recursive: true, force: true });
    });
    secretsDirectory = directory;
  }
  return secretsDirectory;
}

/**
 * Writes a file environment variable to a temporary file and returns its path,
 * mirroring how EAS Build workers expose file variables.
 */
export function materializeFileEnvironmentVariable(name: string, contentsBase64: string): string {
  const contents = Buffer.from(contentsBase64, 'base64');
  const key = crypto.createHash('sha256').update(`${name}:`).update(contents).digest('hex');
  const filePath = path.join(getSecretsDirectory(), key);
  fs.writeFileSync(filePath, new Uint8Array(contents), { mode: 0o600 });
  return filePath;
}

/**
 * Loads "Plain text" and "Sensitive" variables of an EAS environment. File variables
 * resolve to the path of a temporary file holding their contents. "Secret" variables
 * are only readable on EAS servers and are skipped.
 */
export async function fetchServerEnvironmentVariablesAsync(
  graphqlClient: ExpoGraphqlClient,
  { appId, environment }: { appId: string; environment: string }
): Promise<Record<string, string>> {
  const environmentVariables = await EnvironmentVariablesQuery.byAppIdWithSensitiveAsync(
    graphqlClient,
    { appId, environment, includeFileContent: true }
  );

  const env: Record<string, string> = {};
  for (const { name, type, value, valueWithFileContent } of environmentVariables) {
    if (!name) {
      continue;
    }
    if (type === EnvironmentSecretType.FileBase64) {
      if (valueWithFileContent) {
        env[name] = materializeFileEnvironmentVariable(name, valueWithFileContent);
      }
    } else if (value) {
      env[name] = value;
    }
  }
  return env;
}
