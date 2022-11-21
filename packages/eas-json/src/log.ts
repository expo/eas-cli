import chalk from 'chalk';
import terminalLink from 'terminal-link';

// link function from packages/eas-cli/src/log.ts
export function link(
  url: string,
  { text = url, dim = true }: { text?: string; dim?: boolean } = {}
): string {
  let output: string;
  if (terminalLink.isSupported) {
    output = terminalLink(text, url);
  } else {
    output = `${text === url ? '' : text + ': '}${chalk.underline(url)}`;
  }
  return dim ? chalk.dim(output) : output;
}
