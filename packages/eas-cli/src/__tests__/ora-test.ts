jest.unmock('ora');

import { ora } from '../ora';

function createFakeTtyStream(columns: number): NodeJS.WriteStream & { clearedLines: number } {
  return {
    isTTY: true,
    columns,
    clearedLines: 0,
    write: jest.fn(),
    moveCursor: jest.fn(),
    cursorTo: jest.fn(),
    clearLine(this: { clearedLines: number }) {
      this.clearedLines++;
    },
  } as unknown as NodeJS.WriteStream & { clearedLines: number };
}

describe(ora, () => {
  it('clears all wrapped lines after the terminal gets narrower', () => {
    const stream = createFakeTtyStream(200);
    const spinner = ora({ text: 'x'.repeat(100), stream, isEnabled: true });

    spinner.render();
    spinner.render();
    expect(stream.clearedLines).toBe(1);

    stream.columns = 40;
    // The frame on screen was written at the old width, so it is cleared with the old line count.
    spinner.render();
    stream.clearedLines = 0;
    spinner.render();
    // "- " + 100 characters wraps to 3 lines at 40 columns.
    expect(stream.clearedLines).toBe(3);
  });
});
