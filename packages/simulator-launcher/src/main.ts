import path from 'node:path';

import { claimAsync } from './commands/claim';
import { startAsync } from './commands/start';
import { stopAsync } from './commands/stop';
import { commands } from './utils/processes';

export async function mainAsync(args = process.argv.slice(2)): Promise<number> {
  if (process.platform !== 'darwin') {
    throw new Error('simulator-launcher requires macOS (darwin).');
  }
  if (args.length === 1 && args[0] === '--version') {
    process.stdout.write(`${require('../package.json').version}\n`);
    return 0;
  }
  const [command, engine, requestedDevice] = args;
  if (command !== 'start' && command !== 'stop' && command !== 'claim') {
    throw new Error('Usage: simulator-launcher <start|stop|claim ENGINE [DEVICE]>');
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
      return await startAsync(bootUuid);
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
