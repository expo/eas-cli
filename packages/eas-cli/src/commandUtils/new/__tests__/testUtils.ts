import Log from '../../../log';

export class LogSpy {
  private readonly logSpy: jest.SpyInstance;

  constructor(logMethod: 'warn' | 'log' | 'withTick') {
    this.logSpy = jest.spyOn(Log, logMethod);
  }

  getLogOutput(): string[] {
    return this.logSpy.mock.calls.map(call => (call.length === 0 ? '' : call.join(' ')));
  }

  expectLogToContain(message: string): void {
    const output = this.getLogOutput();
    // strip out ANSI codes and special characters like the tick
    const outputWithoutAnsi = output.map(line =>
      line.replace(/\x1b\[[0-9;]*m/g, '').replace(/✔\s*/, '')
    );
    expect(outputWithoutAnsi.some(line => line.includes(message))).toBeTruthy();
  }

  restore(): void {
    this.logSpy.mockRestore();
  }
}
