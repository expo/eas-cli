import chalk from 'chalk';
import figures from 'figures';
import { boolish } from 'getenv';
import logSymbols from 'log-symbols';
import terminalLink from 'terminal-link';

type Color = (...text: string[]) => string;

export default class Log {
  public static readonly isDebug = boolish('EXPO_DEBUG', false);

  constructor(private readonly jsonOutputMode: boolean) {}

  public log(...args: any[]): void {
    this.consoleLog(...args);
  }

  public newLine(): void {
    this.consoleLog();
  }

  public addNewLineIfNone(): void {
    if (!this.isLastLineNewLine) {
      this.newLine();
    }
  }

  public error(...args: any[]): void {
    this.consoleLog(...this.withTextColor(args, chalk.red));
  }

  public warn(...args: any[]): void {
    this.consoleLog(...this.withTextColor(args, chalk.yellow));
  }

  public debug(...args: any[]): void {
    if (Log.isDebug) {
      this.consoleLog(...args);
    }
  }

  public gray(...args: any[]): void {
    this.consoleLog(...this.withTextColor(args, chalk.gray));
  }

  public warnDeprecatedFlag(flag: string, message: string): void {
    this.warn(`› ${chalk.bold('--' + flag)} flag is deprecated. ${message}`);
  }

  public succeed(message: string): void {
    this.log(`${chalk.green(logSymbols.success)} ${message}`);
  }

  public withTick(...args: any[]): void {
    this.consoleLog(chalk.green(figures.tick), ...args);
  }

  private consoleLog(...args: any[]): void {
    this.updateIsLastLineNewLine(args);
    if (this.jsonOutputMode) {
      // eslint-disable-next-line no-console
      console.error(...args);
    } else {
      // eslint-disable-next-line no-console
      console.log(...args);
    }
  }

  private withTextColor(args: any[], chalkColor: Color): string[] {
    return args.map(arg => chalkColor(arg));
  }

  private isLastLineNewLine = false;
  private updateIsLastLineNewLine(args: any[]): void {
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
 * Prints a link for given URL, using text if provided, otherwise text is just the URL.
 * Format links as dim (unless disabled) and with an underline.
 *
 * @example https://expo.dev
 */
export function link(
  url: string,
  { text = url, dim = true }: { text?: string; dim?: boolean } = {}
): string {
  let output: string;
  // Links can be disabled via env variables https://github.com/jamestalmage/supports-hyperlinks/blob/master/index.js
  if (terminalLink.isSupported) {
    output = terminalLink(text, url);
  } else {
    output = `${text === url ? '' : text + ': '}${chalk.underline(url)}`;
  }
  return dim ? chalk.dim(output) : output;
}

/**
 * Provide a consistent "Learn more" link experience.
 * Format links as dim (unless disabled) with an underline.
 *
 * @example Learn more: https://expo.dev
 */
export function learnMore(
  url: string,
  {
    learnMoreMessage: maybeLearnMoreMessage,
    dim = true,
  }: { learnMoreMessage?: string; dim?: boolean } = {}
): string {
  return link(url, { text: maybeLearnMoreMessage ?? 'Learn more', dim });
}
