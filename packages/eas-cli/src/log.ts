import chalk from 'chalk';
import figures from 'figures';

type Color = (...text: string[]) => string;

let _isLastLineNewLine = false;
function _updateIsLastLineNewLine(args: any[]) {
  if (args.length === 0) {
    _isLastLineNewLine = true;
  } else {
    const lastArg = args[args.length - 1];
    if (typeof lastArg === 'string' && (lastArg === '' || lastArg.match(/[\r\n]$/))) {
      _isLastLineNewLine = true;
    } else {
      _isLastLineNewLine = false;
    }
  }
}

function consoleLog(...args: any[]) {
  _updateIsLastLineNewLine(args);

  console.log(...args);
}

function consoleWarn(...args: any[]) {
  _updateIsLastLineNewLine(args);

  console.warn(...args);
}

function consoleError(...args: any[]) {
  _updateIsLastLineNewLine(args);

  console.error(...args);
}

function withTextColor(args: any[], chalkColor: Color) {
  return args.map(arg => chalkColor(arg));
}

function log(...args: any[]) {
  consoleLog(...args);
}

log.newLine = function newLine() {
  consoleLog();
};

log.addNewLineIfNone = function addNewLineIfNone() {
  if (!_isLastLineNewLine) {
    log.newLine();
  }
};

log.error = function error(...args: any[]) {
  consoleError(...withTextColor(args, chalk.red));
};

log.warn = function warn(...args: any[]) {
  consoleWarn(...withTextColor(args, chalk.yellow));
};

log.gray = function (...args: any[]) {
  consoleLog(...withTextColor(args, chalk.gray));
};

log.withTick = function (...args: any[]) {
  consoleLog(chalk.green(figures.tick), ...args);
};

/**
 * Format links as dim with an underline.
 *
 * @example Learn more: https://expo.io
 * @param url
 */
export function learnMore(url: string): string {
  return chalk.dim(`Learn more: ${chalk.underline(url)}`);
}

export default log;
