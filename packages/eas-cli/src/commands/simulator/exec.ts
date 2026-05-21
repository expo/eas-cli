import { load } from '@expo/env';
import spawnAsync from '@expo/spawn-async';
import pkgDir from 'pkg-dir';

import EasCommand from '../../commandUtils/EasCommand';

export default class SimulatorExec extends EasCommand {
  static override hidden = true;
  static override description =
    '[EXPERIMENTAL] execute a simulator command with local .env files loaded';
  static override strict = false;

  async runAsync(): Promise<void> {
    const projectDir = (await pkgDir(process.cwd())) ?? process.cwd();
    load(projectDir, { force: true, silent: true });

    const [command, ...args] = this.argv as [string, ...string[]];
    await spawnAsync(command, args, {
      stdio: 'inherit',
      env: process.env,
    });
  }

  // eslint-disable-next-line async-protect/async-suffix
  protected override async catch(err: Error): Promise<any> {
    process.exitCode = process.exitCode ?? (err as any).status ?? 1;
  }
}
