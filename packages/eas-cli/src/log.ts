import chalk from 'chalk';
import figures from 'figures';
import { boolish } from 'getenv';
import ora from 'ora';
import terminalLink from 'terminal-link';

type Color = (...text: string[]) => string;

export default class Log {
  public static readonly isDebug = boolish('EXPO_DEBUG', false);

  public static log(...args: any[]) {
    Log.consoleLog(...args);
  }

  public static newLine() {
    Log.consoleLog();
  }

  public static addNewLineIfNone() {
    if (!Log.isLastLineNewLine) {
      Log.newLine();
    }
  }

  public static error(...args: any[]) {
    Log.consoleError(...Log.withTextColor(args, chalk.red));
  }

  public static warn(...args: any[]) {
    Log.consoleWarn(...Log.withTextColor(args, chalk.yellow));
  }

  public static gray(...args: any[]) {
    Log.consoleLog(...Log.withTextColor(args, chalk.gray));
  }

  public static warnDeprecatedFlag(flag: string, message: string) {
    Log.warn(`› ${chalk.bold('--' + flag)} flag is deprecated. ${message}`);
  }

  public static succeed(message: string) {
    ora().succeed(message);
  }

  public static withTick(...args: any[]) {
    Log.consoleLog(chalk.green(figures.tick), ...args);
  }

  private static consoleLog(...args: any[]) {
    Log.updateIsLastLineNewLine(args);
    console.log(...args);
  }

  private static consoleWarn(...args: any[]) {
    Log.updateIsLastLineNewLine(args);
    console.warn(...args);
  }

  private static consoleError(...args: any[]) {
    Log.updateIsLastLineNewLine(args);
    console.error(...args);
  }

  private static withTextColor(args: any[], chalkColor: Color) {
    return args.map(arg => chalkColor(arg));
  }

  private static isLastLineNewLine = false;
  private static updateIsLastLineNewLine(args: any[]) {
    if (args.length === 0) {
      Log.isLastLineNewLine = true;
    } else {
      const lastArg = args[args.length - 1];
      if (typeof lastArg === 'string' && (lastArg === '' || lastArg.match(/[\r\n]$/))) {
        Log.isLastLineNewLine = true;
      } else {
        Log.isLastLineNewLine = false;
      }
    }
  }
}

/**
 * Format links as dim (unless disabled) with an underline.
 *
 * @example Learn more: https://expo.io
 * @param url
 */
export function learnMore(
  url: string,
  { learnMoreMessage, dim = true }: { learnMoreMessage?: string; dim?: boolean } = {}
): string {
  // Links can be disabled via env variables https://github.com/jamestalmage/supports-hyperlinks/blob/master/index.js
  if (terminalLink.isSupported) {
    const text = terminalLink(learnMoreMessage ?? 'Learn more.', url);
    return dim ? chalk.dim(text) : text;
  }
  const text = `${learnMoreMessage ?? 'Learn more'}: ${chalk.underline(url)}`;
  return dim ? chalk.dim(text) : text;
}
