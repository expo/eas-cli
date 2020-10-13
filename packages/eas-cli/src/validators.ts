import fs from 'fs-extra';

function nonEmptyInput(val: string) {
  return val !== '';
}

const existingFile = async (filePath: string) => {
  try {
    const stats = await fs.stat(filePath);
    return stats.isFile();
  } catch (e) {
    return false;
  }
};

const promptsExistingFile = async (filePath: string) => {
  try {
    const stats = await fs.stat(filePath);
    if (stats.isFile()) {
      return true;
    }
    return 'Input is not a file.';
  } catch {
    return 'File does not exist.';
  }
};

export { nonEmptyInput, existingFile, promptsExistingFile };
