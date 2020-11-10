import chalk from 'chalk';
import Table from 'cli-table3';
import chunk from 'lodash/chunk';

import log from '../../log';

export function breakWord(word: string, chars: number): string {
  return chunk(word, chars)
    .map((arr: string[]) => arr.join(''))
    .join('\n');
}

export function printSummary<T>(
  summary: T,
  title: string,
  keyMap: Record<keyof T, string>,
  valueRemap: Partial<Record<keyof T, Function>>
): void {
  const table = new Table({
    colWidths: [25, 55],
    wordWrap: true,
  });
  table.push([
    {
      colSpan: 2,
      content: chalk.bold(title),
      hAlign: 'center',
    },
  ]);
  for (const [key, value] of Object.entries(summary)) {
    const displayKey = keyMap[key as keyof T];
    const displayValue = valueRemap[key as keyof T]?.(value) ?? value;
    table.push([displayKey, displayValue]);
  }
  log(table.toString());
}
