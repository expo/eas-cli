import fs from 'fs-extra';
import path from 'path';

import Log from '../log.js';

function getRenamedFilename(filename: string, num: number): string {
  const ext = path.extname(filename);
  const basename = path.basename(filename, ext);
  return `${basename}_OLD_${num}${ext}`;
}

export async function maybeRenameExistingFileAsync(
  projectDir: string,
  filename: string
): Promise<void> {
  const desiredFilePath = path.resolve(projectDir, filename);

  if (await fs.pathExists(desiredFilePath)) {
    let num = 1;
    while (await fs.pathExists(path.resolve(projectDir, getRenamedFilename(filename, num)))) {
      num++;
    }
    Log.log(
      `\nA file already exists at "${desiredFilePath}"\n  Renaming the existing file to ${getRenamedFilename(
        filename,
        num
      )}\n`
    );
    await fs.rename(desiredFilePath, path.resolve(projectDir, getRenamedFilename(filename, num)));
  }
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) {
    return `0`;
  }
  let multiplier = 1;
  if (bytes < 1024 * multiplier) {
    return `${Math.floor(bytes)} B`;
  }
  multiplier *= 1024;
  if (bytes < 102.4 * multiplier) {
    return `${(bytes / multiplier).toFixed(1)} KB`;
  }
  if (bytes < 1024 * multiplier) {
    return `${Math.floor(bytes / 1024)} KB`;
  }
  multiplier *= 1024;
  if (bytes < 102.4 * multiplier) {
    return `${(bytes / multiplier).toFixed(1)} MB`;
  }
  if (bytes < 1024 * multiplier) {
    return `${Math.floor(bytes / multiplier)} MB`;
  }
  multiplier *= 1024;
  if (bytes < 102.4 * multiplier) {
    return `${(bytes / multiplier).toFixed(1)} GB`;
  }
  return `${Math.floor(bytes / 1024)} GB`;
}
