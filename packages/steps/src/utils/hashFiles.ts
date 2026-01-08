import { createHash } from 'crypto';

import fs from 'fs-extra';

/**
 * Hashes the contents of multiple files and returns a combined SHA256 hash.
 * @param filePaths Array of absolute file paths to hash
 * @returns Combined SHA256 hash of all files, or empty string if no files exist
 */
export function hashFiles(filePaths: string[]): string {
  const combinedHash = createHash('sha256');
  let hasFound = false;

  for (const filePath of filePaths) {
    try {
      if (fs.pathExistsSync(filePath)) {
        const fileContent = fs.readFileSync(filePath);
        const fileHash = createHash('sha256').update(fileContent).digest();
        combinedHash.write(fileHash);
        hasFound = true;
      }
    } catch (err: any) {
      throw new Error(`Failed to hash file ${filePath}: ${err.message}`);
    }
  }

  combinedHash.end();
  const result = combinedHash.digest('hex');

  if (!hasFound) {
    return '';
  }

  return result;
}
