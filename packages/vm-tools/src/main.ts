import path from 'node:path';

import { runStartupScriptOncePerBootAsync } from './commands/daemon';
import { installStartupDaemonAsync } from './commands/install';

export async function runCliAsync(): Promise<void> {
  try {
    switch (process.argv[2]) {
      case 'install':
        await installStartupDaemonAsync(
          __filename,
          path.join(__dirname, '../resources/com.expo.vm-tools.plist')
        );
        break;
      case 'daemon':
        process.exitCode = await runStartupScriptOncePerBootAsync();
        break;
      default:
        throw new Error('Usage: vm-tools <install|daemon>');
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  void runCliAsync();
}
