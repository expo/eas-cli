import { UserError } from '@expo/eas-build-job';
import fs from 'node:fs';
import path from 'node:path';

const WORKSPACE_EXTENSION = '.xcworkspace';
const PROJECT_EXTENSION = '.xcodeproj';

export function isWorkspace(projectFilePath: string): boolean {
  return path.extname(projectFilePath) === WORKSPACE_EXTENSION;
}

export async function resolveProjectFilePathAsync({
  projectDirectory,
  baseDirectory,
  repositoryDirectory,
  projectFile,
}: {
  projectDirectory: string;
  baseDirectory: string;
  repositoryDirectory: string;
  projectFile?: string;
}): Promise<string> {
  const fromRepositoryRoot = (absolutePath: string): string =>
    `/${path.relative(repositoryDirectory, absolutePath)}`;
  const searchedDirectory = `"${fromRepositoryRoot(projectDirectory)}" (a path from the repository root)`;
  const howToSetProjectDirectory = `"project_directory" is read from the app's base directory, which is "${fromRepositoryRoot(baseDirectory)}". Set "project_directory" to a path relative to the base directory, or to a path from the repository root that starts with "/".`;

  if (projectFile) {
    if (![WORKSPACE_EXTENSION, PROJECT_EXTENSION].includes(path.extname(projectFile))) {
      throw new UserError(
        'NATIVE_XCODE_INVALID_PROJECT_FILE',
        `"xcode_project_file" is "${projectFile}", which is not an Xcode workspace or project. Set it to the path of a "${WORKSPACE_EXTENSION}" or "${PROJECT_EXTENSION}", relative to "project_directory".`
      );
    }
    const projectFilePath = path.resolve(projectDirectory, projectFile);
    if (!fs.existsSync(projectFilePath)) {
      throw new UserError(
        'NATIVE_XCODE_PROJECT_FILE_NOT_FOUND',
        `"xcode_project_file" is "${projectFile}", but EAS found nothing at "${fromRepositoryRoot(projectFilePath)}" (a path from the repository root). "xcode_project_file" is read from "project_directory", which is "${fromRepositoryRoot(projectDirectory)}" in this build. Check both values and that the file is committed. A workspace that "pod install" creates exists only when that directory has a Podfile.`
      );
    }
    return projectFilePath;
  }

  const entries = await readSortedEntriesAsync(projectDirectory);
  if (!entries) {
    throw new UserError(
      'NATIVE_XCODE_PROJECT_FILE_NOT_FOUND',
      `EAS looks for the Xcode project in ${searchedDirectory}, and that directory does not exist. ${howToSetProjectDirectory}`
    );
  }
  for (const extension of [WORKSPACE_EXTENSION, PROJECT_EXTENSION]) {
    const candidates = entries.filter(entry => path.extname(entry) === extension);
    if (candidates.length > 1) {
      throw new UserError(
        'NATIVE_XCODE_AMBIGUOUS_PROJECT_FILE',
        `Found ${candidates.length} "${extension}" entries in ${searchedDirectory}: ${candidates.join(', ')}. EAS cannot tell which one to build. Set "xcode_project_file" to one of them.`
      );
    }
    if (candidates.length === 1) {
      return path.join(projectDirectory, candidates[0]);
    }
  }
  throw new UserError(
    'NATIVE_XCODE_PROJECT_FILE_NOT_FOUND',
    `Found no "${WORKSPACE_EXTENSION}" and no "${PROJECT_EXTENSION}" in ${searchedDirectory}. ${howToSetProjectDirectory}`
  );
}

async function readSortedEntriesAsync(directory: string): Promise<string[] | undefined> {
  try {
    return (await fs.promises.readdir(directory)).sort();
  } catch (err: any) {
    if (err?.code === 'ENOENT') {
      return undefined;
    }
    throw err;
  }
}
