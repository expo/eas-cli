import fs from 'fs-extra';
import path from 'path';

import log from '../log';

export async function maybeRenameExistingFileAsync(projectDir: string, filename: string) {
  const desiredFilePath = path.resolve(projectDir, filename);

  if (await fs.pathExists(desiredFilePath)) {
    let num = 1;
    while (await fs.pathExists(path.resolve(projectDir, `OLD_${num}_${filename}`))) {
      num++;
    }
    log(
      `\nA file already exists at "${desiredFilePath}"\n  Renaming the existing file to OLD_${num}_${filename}\n`
    );
    await fs.rename(desiredFilePath, path.resolve(projectDir, `OLD_${num}_${filename}`));
  }
}
