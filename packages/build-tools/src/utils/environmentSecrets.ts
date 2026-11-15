import { type EnvironmentSecret, EnvironmentSecretType } from '@expo/eas-build-job';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

/**
 * Returns the value of the string environment secret with this name, or null. It resolves
 * duplicate names like the build context env does (the last secret wins). A file secret has no
 * string value.
 */
export function getStringEnvironmentSecretValue(
  environmentSecrets: EnvironmentSecret[] | undefined,
  name: string
): string | null {
  const secret = Array.from(environmentSecrets ?? [])
    .reverse()
    .find(secret => secret.name === name);
  if (!secret || secret.type !== EnvironmentSecretType.STRING || !secret.value) {
    return null;
  }
  return secret.value;
}

export function createTemporaryEnvironmentSecretFile({
  secretsDir,
  name,
  contents_base64,
}: {
  secretsDir: string;
  name: string;
  contents_base64: string;
}): string {
  const contentsBuffer = Buffer.from(contents_base64, 'base64');

  const hash = crypto.createHash('sha256');
  hash.update(`${name}:`);
  hash.update(new Uint8Array(contentsBuffer));
  const key = hash.digest('hex');

  const randomFilePath = path.join(secretsDir, key);
  fs.writeFileSync(randomFilePath, new Uint8Array(contentsBuffer));

  return randomFilePath;
}
