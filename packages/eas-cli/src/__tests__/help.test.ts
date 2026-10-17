import { Config, Help } from '@oclif/core';

import SimulatorControl from '../commands/simulator/control';
import EasHelp from '../help';

describe(EasHelp, () => {
  const config = new Config({ root: __dirname });
  let run: jest.SpyInstance;
  let showHelp: jest.SpyInstance;

  beforeEach(() => {
    run = jest.spyOn(SimulatorControl, 'run').mockResolvedValue(Promise.resolve());
    showHelp = jest.spyOn(Help.prototype, 'showHelp').mockResolvedValue();
  });

  afterEach(() => jest.restoreAllMocks());

  it.each([
    ['simulator:control', 'rotate', '--help'],
    ['sim:control', 'screenshot.capture', '-h', '--id', 'session-123'],
    ['simulator:control', '--id', 'session-123', '--help', 'rotate'],
  ])('routes action help through the command: %j', async (...argv) => {
    await new EasHelp(config).showHelp(argv);
    expect(run).toHaveBeenCalledWith(argv.slice(1), config);
    expect(showHelp).not.toHaveBeenCalled();
  });

  it.each([
    ['simulator:control', '--help'],
    ['sim:control', '-h'],
    ['build', '--help'],
    ['simulator:control', 'clipboard.write', '--', '--help'],
  ])('preserves regular help and literal values: %j', async (...argv) => {
    await new EasHelp(config).showHelp(argv);
    expect(showHelp).toHaveBeenCalledWith(argv);
    expect(run).not.toHaveBeenCalled();
  });
});
