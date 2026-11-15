import { Help, Parser } from '@oclif/core';

import { isSimulatorCommandId } from './simulator/commandAliases';

export default class EasHelp extends Help {
  // eslint-disable-next-line async-protect/async-suffix -- oclif defines the method name.
  override async showHelp(argv: string[]): Promise<void> {
    const [command, ...args] = argv;
    if (isSimulatorCommandId(command, 'control')) {
      const { default: SimulatorControl } = await import('./commands/simulator/control');
      let parsed;
      try {
        parsed = await Parser.parse(args, {
          args: SimulatorControl.args,
          flags: SimulatorControl.flags,
          strict: false,
        });
      } catch {
        await super.showHelp(argv);
        return;
      }
      if (parsed.args.action && parsed.flags.help) {
        await this.config.runCommand('simulator:control', args);
        return;
      }
    }
    await super.showHelp(argv);
  }
}
