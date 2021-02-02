import chalk from 'chalk';
import figures from 'figures';
import { boolish } from 'getenv';
import ora from 'ora';
import terminalLink from 'terminal-link';

type Color = (...text: string[]) => string;

class Log {
  public static readonly isDebug = boolish('EXPO_DEBUG', false);

  public static log(...args: any[]) {
    this.consoleLog(...args);
  }

  public static newLine() {
    this.consoleLog();
  }

  public static addNewLineIfNone() {
    if (!this.isLastLineNewLine) {
      this.newLine();
    }
  }

  public static error(...args: any[]) {
    this.consoleError(...this.withTextColor(args, chalk.red));
  }

  public static warn(...args: any[]) {
    this.consoleWarn(...this.withTextColor(args, chalk.yellow));
  }

  public static gray(...args: any[]) {
    this.consoleLog(...this.withTextColor(args, chalk.gray));
  }

  public static succeed(message: string) {
    ora().succeed(message);
  }

  public static withTick(...args: any[]) {
    this.consoleLog(chalk.green(figures.tick), ...args);
  }

  private static consoleLog(...args: any[]) {
    this.updateIsLastLineNewLine(args);
    console.log(...args);
  }

  private static consoleWarn(...args: any[]) {
    this.updateIsLastLineNewLine(args);
    console.warn(...args);
  }

  private static consoleError(...args: any[]) {
    this.updateIsLastLineNewLine(args);
    console.error(...args);
  }

  private static withTextColor(args: any[], chalkColor: Color) {
    return args.map(arg => chalkColor(arg));
  }

  private static isLastLineNewLine = false;
  private static updateIsLastLineNewLine(args: any[]) {
    if (args.length === 0) {
      this.isLastLineNewLine = true;
    } else {
      const lastArg = args[args.length - 1];
      if (typeof lastArg === 'string' && (lastArg === '' || lastArg.match(/[\r\n]$/))) {
        this.isLastLineNewLine = true;
      } else {
        this.isLastLineNewLine = false;
      }
    }
  }
}

/**
 * Format links as dim with an underline.
 *
 * @example Learn more: https://expo.io
 * @param url
 */
export function learnMore(url: string, learnMoreMessage?: string): string {
  // Links can be disabled via env variables https://github.com/jamestalmage/supports-hyperlinks/blob/master/index.js
  if (terminalLink.isSupported) {
    return chalk.dim(terminalLink(learnMoreMessage ?? 'Learn more.', url));
  }
  return chalk.dim(`${learnMoreMessage ?? 'Learn more'}: ${chalk.underline(url)}`);
}

export default Log;
