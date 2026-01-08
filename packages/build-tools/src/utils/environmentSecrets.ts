import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

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
  hash.update(contentsBuffer);
  const key = hash.digest('hex');

  const randomFilePath = path.join(secretsDir, key);
  fs.writeFileSync(randomFilePath, contentsBuffer);

  return randomFilePath;
}
