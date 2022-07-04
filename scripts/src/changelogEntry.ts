import { CATEGORY_HEADERS, EntryCategory } from './changelog/consts.js';
import { readAndParseChangelogAsync, writeChangelogAsync } from './changelog/file.js';
import * as markdown from './markdown.js';
import { nullthrows } from './nullthrows.js';

const [rawCategory, ...rest] = process.argv.slice(2);
const message = rest.join(' ');

interface Entry {
  category: EntryCategory;
  message: string;
  author: string;
  prNumber: number;
}

(async function main(rawCategory: string, rawMessage: string): Promise<void> {
  const [category, message] = sanitizeInput(rawCategory, rawMessage);

  const entry: Entry = {
    category,
    message,
    author: nullthrows(process.env.GITHUB_PR_AUTHOR),
    prNumber: Number(nullthrows(process.env.GITHUB_PR_NUMBER)),
  };

  const tokens = await readAndParseChangelogAsync();
  addEntry(tokens, entry);
  await writeChangelogAsync(tokens);
})(rawCategory, message).catch(err => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});

function addEntry(tokens: markdown.Tokens, entry: Entry): void {
  const categoryHeader = CATEGORY_HEADERS[entry.category];

  let i = 0;
  while (true) {
    const token = tokens[i];
    if (
      token.type === markdown.TokenType.HEADING &&
      token.depth === 3 &&
      token.text === categoryHeader
    ) {
      break;
    } else {
      i++;
    }
  }

  // i points at the category heading
  if (tokens[i + 1].type === markdown.TokenType.HEADING) {
    // no list yet
    const listToken = markdown.createListToken(0);
    const spaceToken = markdown.createSpaceToken('\n\n');
    tokens.splice(i + 1, 0, listToken, spaceToken);
  }

  // tokens[i + 1] is a list token
  const listToken = tokens[i + 1] as unknown as markdown.ListToken;
  const entryMarkdown = formatEntry(entry);
  const listItemToken = markdown.createListItemToken(entryMarkdown);
  listToken.items.push(listItemToken);
}

function formatEntry({ message, prNumber, author }: Entry): string {
  const capitalizedMessage = `${message[0].toUpperCase()}${message.slice(1)}`;
  const messageWithDot = capitalizedMessage.endsWith('.')
    ? capitalizedMessage
    : `${capitalizedMessage}.`;
  return `${messageWithDot} ([#${prNumber}](https://github.com/expo/eas-cli/pull/${prNumber}) by [@${author}](https://github.com/${author}))`;
}

function sanitizeInput(
  rawCategory: string,
  rawMessage: string
): [category: EntryCategory, message: string] {
  if (!rawCategory || !rawMessage) {
    throw new Error(
      'Usage: yarn changelog-entry [breaking-change|new-feature|bug-fix|chore] [message]'
    );
  }

  const category = sanitizeCategory(rawCategory.trim());
  const message = rawMessage.trim();
  if (message === '') {
    throw new Error('Message cannot be empty string');
  }
  return [category, message];
}

function sanitizeCategory(rawCategory: string): EntryCategory {
  if (Object.values(EntryCategory).includes(rawCategory as any)) {
    return rawCategory as EntryCategory;
  } else {
    throw new Error(`Invalid changelog entry category: ${rawCategory}`);
  }
}
