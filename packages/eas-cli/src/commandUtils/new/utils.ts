import path from 'path';

/**
 * Formats a directory path for display.
 * If the directory is within the current working directory, returns a relative path.
 * Otherwise, returns the absolute path.
 */
export function printDirectory(directory: string): string {
  const cwd = process.cwd();
  const absoluteDir = path.isAbsolute(directory) ? directory : path.resolve(cwd, directory);

  const relativePath = path.relative(cwd, absoluteDir);

  // If the relative path doesn't start with '..' it means it's within or at the cwd
  if (!relativePath.startsWith('..') && !path.isAbsolute(relativePath)) {
    return relativePath !== '' ? `./${relativePath}` : '.';
  }

  return absoluteDir;
}
