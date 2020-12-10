import chalk from 'chalk';

import Log from '../../log';

export function printSummary<T>(
  summary: T,
  keyMap: Record<keyof T, string>,
  valueRemap: Partial<Record<keyof T, Function>>
): void {
  const padWidth = longestStringLength(Object.keys(summary).map(key => keyMap[key as keyof T]));

  const tableFormat = (name: string, msg: string) =>
    `${chalk.bold.cyan(pad(`${name}:`, padWidth + 1))} ${msg}`;

  Log.newLine();
  for (const [key, value] of Object.entries(summary)) {
    const displayKey = chalk.cyan(keyMap[key as keyof T]);
    const displayValue = valueRemap[key as keyof T]?.(value) ?? value;
    Log.log(tableFormat(displayKey, displayValue));
  }
  Log.addNewLineIfNone();
}

function pad(str: string, width: number): string {
  const len = Math.max(0, width - str.length);
  return str + Array(len + 1).join(' ');
}

function longestStringLength(values: string[]): number {
  return values.reduce((max, option) => Math.max(max, option.length), 0);
}
