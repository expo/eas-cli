/* eslint-disable no-console */

import chalk from 'chalk';

import { validateEntry } from './changelog/entry.js';
import { readAndParseChangelogAsync } from './changelog/file.js';
import * as markdown from './markdown.js';
interface InvalidEntry {
  entry: string;
  errors: Error[];
}

(async function main(): Promise<void> {
  const invalidEntries: InvalidEntry[] = [];

  const tokens = await readAndParseChangelogAsync();
  const listTokens = tokens.filter(
    (token): token is markdown.ListToken => token.type === markdown.TokenType.LIST
  );
  for (const listToken of listTokens) {
    for (const item of listToken.items) {
      if (item.raw) {
        const errors = validateEntry(item.raw);
        if (errors) {
          invalidEntries.push({
            entry: item.raw,
            errors,
          });
        }
      }
    }
  }

  if (invalidEntries.length === 0) {
    console.log('CHANGELOG.md is valid');
    return;
  }

  console.error('CHANGELOG.md is invalid:');
  for (const invalidEntry of invalidEntries) {
    console.error(invalidEntry.entry.trim());
    for (const error of invalidEntry.errors) {
      console.error(chalk.red(` ${error}`));
    }
  }
  process.exit(1);
})().catch(err => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
