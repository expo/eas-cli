import fs from 'node:fs/promises';
import path from 'node:path';

import { claimAsync } from './commands/claim';
import { startAsync } from './commands/start';
import { stopAsync } from './commands/stop';
import { runInstalledLauncherCommandAsync } from './utils/installedLauncher';
import { commands } from './utils/processes';
import { getInstalledLauncherDirectory } from './utils/state';

export async function mainAsync(args = process.argv.slice(2)): Promise<number> {
  if (process.platform !== 'darwin') {
    throw new Error('simulator-launcher requires macOS (darwin).');
  }
  const [command, engine, requestedDevice] = args;
  if (command !== 'start' && command !== 'stop' && command !== 'claim') {
    throw new Error('Usage: simulator-launcher <start|stop|claim ENGINE [DEVICE]>');
  }
  const installedLauncherPath = path.join(getInstalledLauncherDirectory(), 'run');
  const isInstalledLauncher = path.resolve(__filename) === installedLauncherPath;
  if ((command === 'stop' || command === 'claim') && !isInstalledLauncher) {
    const installedLauncherExists = await fs
      .stat(installedLauncherPath)
      .then(() => true)
      .catch(error => {
        if (command !== 'stop' || error.code !== 'ENOENT') {
          throw error;
        }
        return false;
      });
    if (installedLauncherExists) {
      return await runInstalledLauncherCommandAsync([command, ...args.slice(1)]);
    }
  }
  const bootUuid = (
    await commands.runAsync('/usr/sbin/sysctl', ['-n', 'kern.bootsessionuuid'])
  ).trim();
  if (!bootUuid) {
    throw new Error(
      'Could not read the VM boot identifier (kern.bootsessionuuid); startup cannot continue.'
    );
  }
  switch (command) {
    case 'start':
      return await startAsync(bootUuid, __filename);
    case 'stop':
      return await stopAsync(bootUuid);
    case 'claim':
      return await claimAsync(bootUuid, engine, requestedDevice);
  }
}

export async function runCliAsync(): Promise<void> {
  try {
    process.exitCode = await mainAsync();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
    process.exitCode = 1;
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  void runCliAsync();
}
