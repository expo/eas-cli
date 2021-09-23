import chalk from 'chalk';
import figures from 'figures';
import { boolish } from 'getenv';
import logSymbols from 'log-symbols';
import terminalLink from 'terminal-link';

type Color = (...text: string[]) => string;

export default class Log {
  public static readonly isDebug = boolish('EXPO_DEBUG', false);

  public static log(...args: any[]): void {
    Log.consoleLog(...args);
  }

  public static newLine(): void {
    Log.consoleLog();
  }

  public static addNewLineIfNone(): void {
    if (!Log.isLastLineNewLine) {
      Log.newLine();
    }
  }

  public static error(...args: any[]): void {
    Log.consoleError(...Log.withTextColor(args, chalk.red));
  }

  public static warn(...args: any[]): void {
    Log.consoleWarn(...Log.withTextColor(args, chalk.yellow));
  }

  public static debug(...args: any[]): void {
    if (Log.isDebug) {
      Log.consoleLog(...args);
    }
  }

  public static gray(...args: any[]): void {
    Log.consoleLog(...Log.withTextColor(args, chalk.gray));
  }

  public static warnDeprecatedFlag(flag: string, message: string): void {
    Log.warn(`› ${chalk.bold('--' + flag)} flag is deprecated. ${message}`);
  }

  public static succeed(message: string): void {
    Log.log(`${chalk.green(logSymbols.success)} ${message}`);
  }

  public static withTick(...args: any[]): void {
    Log.consoleLog(chalk.green(figures.tick), ...args);
  }

  private static consoleLog(...args: any[]): void {
    Log.updateIsLastLineNewLine(args);
    // eslint-disable-next-line no-console
    console.log(...args);
  }

  private static consoleWarn(...args: any[]): void {
    Log.updateIsLastLineNewLine(args);
    // eslint-disable-next-line no-console
    console.warn(...args);
  }

  private static consoleError(...args: any[]): void {
    Log.updateIsLastLineNewLine(args);
    // eslint-disable-next-line no-console
    console.error(...args);
  }

  private static withTextColor(args: any[], chalkColor: Color): string[] {
    return args.map(arg => chalkColor(arg));
  }

  private static isLastLineNewLine = false;
  private static updateIsLastLineNewLine(args: any[]): void {
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
 * @example Learn more: https://expo.dev
 * @param url
 */
export function learnMore(
  url: string,
  {
    learnMoreMessage: maybeLearnMoreMessage,
    dim = true,
  }: { learnMoreMessage?: string; dim?: boolean } = {}
): string {
  // Links can be disabled via env variables https://github.com/jamestalmage/supports-hyperlinks/blob/master/index.js
  if (terminalLink.isSupported) {
    const text = terminalLink(maybeLearnMoreMessage ?? 'Learn more.', url);
    return dim ? chalk.dim(text) : text;
  }
  const learnMoreMessage = maybeLearnMoreMessage ?? 'Learn more';
  const text = `${
    learnMoreMessage === '' ? learnMoreMessage : `${learnMoreMessage}: `
  }${chalk.underline(url)}`;
  return dim ? chalk.dim(text) : text;
}
