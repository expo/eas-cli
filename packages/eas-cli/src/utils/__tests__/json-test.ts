describe('printJsonErrorOutput', () => {
  const originalStdoutWrite = process.stdout.write;
  const originalStderrWrite = process.stderr.write;

  afterEach(() => {
    jest.restoreAllMocks();
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
  });

  it('prints one error object on stdout, without ANSI codes, once per process', () => {
    const stdout = jest.fn(() => true);
    const stderr = jest.fn(() => true);
    process.stdout.write = stdout as any;
    process.stderr.write = stderr as any;
    // Jest's console does not write through process.stdout, so record which stream was live.
    const printed: { text: string; toStdout: boolean }[] = [];
    jest.spyOn(console, 'log').mockImplementation((text: string) => {
      printed.push({ text, toStdout: process.stdout.write === stdout });
    });

    jest.isolateModules(() => {
      const { printJsonErrorOutput } = require('../json');
      printJsonErrorOutput({
        message: '\u001b[31mEAS project not configured.\u001b[39m',
      });
      printJsonErrorOutput({ message: 'update:republish command failed.' });
    });

    expect(printed).toHaveLength(1);
    expect(printed[0].toStdout).toBe(true);
    expect(JSON.parse(printed[0].text)).toEqual({
      error: { message: 'EAS project not configured.' },
    });
  });
});
