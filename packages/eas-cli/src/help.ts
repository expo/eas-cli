import { Help, Parser } from '@oclif/core';

export default class EasHelp extends Help {
  // eslint-disable-next-line async-protect/async-suffix -- oclif defines the method name.
  override async showHelp(argv: string[]): Promise<void> {
    const [command, ...args] = argv;
    if (command === 'simulator:control' || command === 'sim:control') {
      const { default: SimulatorControl } = await import('./commands/simulator/control');
      const parsed = await Parser.parse(args, {
        args: SimulatorControl.args,
        flags: SimulatorControl.flags,
        strict: false,
      });
      if (parsed.args.action && parsed.flags.help) {
        await SimulatorControl.run(args, this.config);
        return;
      }
    }
    await super.showHelp(argv);
  }
}
