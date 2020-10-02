import fs from 'fs-extra';
import path from 'path';

import log from '../log';

function getRenamedFilename(filename: string, num: number): string {
  const ext = path.extname(filename);
  const basename = path.basename(filename, ext);
  return `${basename}_OLD_${num}${ext}`;
}

export async function maybeRenameExistingFileAsync(projectDir: string, filename: string) {
  const desiredFilePath = path.resolve(projectDir, filename);

  if (await fs.pathExists(desiredFilePath)) {
    let num = 1;
    while (await fs.pathExists(path.resolve(projectDir, getRenamedFilename(filename, num)))) {
      num++;
    }
    log(
      `\nA file already exists at "${desiredFilePath}"\n  Renaming the existing file to ${getRenamedFilename(
        filename,
        num
      )}\n`
    );
    await fs.rename(desiredFilePath, path.resolve(projectDir, getRenamedFilename(filename, num)));
  }
}
