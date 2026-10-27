import { Config, Help } from '@oclif/core';

import EasHelp from '../help';

describe(EasHelp, () => {
  const config = new Config({ root: __dirname });
  let run: jest.SpyInstance;
  let showHelp: jest.SpyInstance;

  beforeEach(() => {
    run = jest.spyOn(config, 'runCommand').mockResolvedValue(Promise.resolve());
    showHelp = jest.spyOn(Help.prototype, 'showHelp').mockResolvedValue();
  });

  afterEach(() => jest.restoreAllMocks());

  it.each([
    ['simulator:control', 'rotate', '--help'],
    ['sim:control', 'screenshot.capture', '-h', '--id', 'session-123'],
    ['simulator:control', '--id', 'session-123', '--help', 'rotate'],
  ])('routes action help through the command: %j', async (...argv) => {
    await new EasHelp(config).showHelp(argv);
    expect(run).toHaveBeenCalledWith('simulator:control', argv.slice(1));
    expect(showHelp).not.toHaveBeenCalled();
  });

  it.each([
    ['simulator:control', '--help'],
    ['simulator:control', 'screenshot.capture', '--help', '--output'],
    ['sim:control', 'rotate', '-h', '--id'],
    ['sim:control', '-h'],
    ['build', '--help'],
    ['simulator:control', 'clipboard.write', '--', '--help'],
  ])('preserves regular help and literal values: %j', async (...argv) => {
    await new EasHelp(config).showHelp(argv);
    expect(showHelp).toHaveBeenCalledWith(argv);
    expect(run).not.toHaveBeenCalled();
  });
});
