import * as fs from 'fs-extra';
import os from 'os';
import path from 'path';
import * as tar from 'tar';

export async function createAppArchiveAsync(
  value: string
): Promise<{ path: string; cleanupAsync: () => Promise<void> }> {
  const bundle = await fs.realpath(value);
  // Create and register cleanup in one synchronous turn so an interrupt cannot
  // leave a newly created directory without its exit handler.
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'eas-simulator-app-'));
  const archive = path.join(directory, 'app.tar.gz');
  const cleanupOnExit = (): void => {
    try {
      fs.removeSync(directory);
    } catch {
      // Exit cleanup is best effort; do not prevent the interrupted process from stopping.
    }
  };
  const interrupt = (): never => {
    cleanupOnExit();
    process.exit(130);
  };
  const terminate = (): never => {
    cleanupOnExit();
    process.exit(143);
  };
  process.once('exit', cleanupOnExit);
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', terminate);
  const cleanupAsync = async (): Promise<void> => {
    try {
      await fs.remove(directory);
    } finally {
      process.removeListener('exit', cleanupOnExit);
      process.removeListener('SIGINT', interrupt);
      process.removeListener('SIGTERM', terminate);
    }
  };
  try {
    await tar.create(
      {
        cwd: bundle,
        file: archive,
        prefix: path.basename(path.resolve(value)),
        gzip: true,
        portable: true,
        jobs: 1,
      },
      ['.']
    );
    return { path: archive, cleanupAsync };
  } catch (error) {
    await cleanupAsync();
    throw error;
  }
}
