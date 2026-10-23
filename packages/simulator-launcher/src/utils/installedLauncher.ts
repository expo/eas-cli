import path from 'node:path';

import { commands } from './processes';
import { getInstalledLauncherDirectory } from './state';

// Run the bundle copied by start, forwarding signals and waiting for the command to finish.
export async function runInstalledLauncherCommandAsync(args: string[]): Promise<number> {
  const childProcessHandle = commands.start(process.execPath, [
    path.join(getInstalledLauncherDirectory(), 'run'),
    ...args,
  ]);
  const forwardSignal = (signal: NodeJS.Signals): void => {
    childProcessHandle.child.kill(signal);
  };
  process.on('SIGTERM', forwardSignal);
  process.on('SIGINT', forwardSignal);
  try {
    await childProcessHandle.resultPromise;
    return 0;
  } finally {
    process.off('SIGTERM', forwardSignal);
    process.off('SIGINT', forwardSignal);
  }
}
