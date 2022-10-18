import { nullthrows } from '../nullthrows.js';

export interface Entry {
  category: EntryCategory;
  message: string;
  author: string;
  prNumber: number;
}

export enum EntryCategory {
  BreakingChange = 'breaking-change',
  NewFeature = 'new-feature',
  BugFix = 'bug-fix',
  Chore = 'chore',
}

export function formatEntry({ message, prNumber, author }: Entry): string {
  const capitalizedMessage = `${message[0].toUpperCase()}${message.slice(1)}`;
  const messageWithDot = capitalizedMessage.endsWith('.')
    ? capitalizedMessage
    : `${capitalizedMessage}.`;
  return `${messageWithDot} ([#${prNumber}](https://github.com/expo/eas-cli/pull/${prNumber}) by [@${author}](https://github.com/${author}))`;
}

const COMMIT_OR_PR_LINK = /\[#?\w+\]\(https:\/\/github\.com\/expo\/eas-cli\/(commit|pull)\/\w+\)/;
const COMMIT_OR_PR_LINK_GROUPS =
  /\[(?<number>#?\w+)\]\(https:\/\/github\.com\/expo\/eas-cli\/(?<path>(commit|pull)\/\w+)\)/;
const COMMIT_OR_PR_LINKS = new RegExp(
  `${COMMIT_OR_PR_LINK.source}(, ${COMMIT_OR_PR_LINK.source})*`
);

const AUTHOR_LINK = /\[@[\w-]+\]\(https:\/\/github\.com\/(apps\/)?[\w-]+\)/;
const AUTHOR_LINK_GROUPS =
  /\[@(?<author1>[\w-]+)\]\(https:\/\/github\.com\/(apps\/)?(?<author2>[\w-]+)\)/;
const AUTHORS = new RegExp(`by ${AUTHOR_LINK.source}(, ${AUTHOR_LINK.source})*`);

const ENTRY_REGEX = new RegExp(
  `.+ \\(${COMMIT_OR_PR_LINKS.source} ${AUTHORS.source}(, ${COMMIT_OR_PR_LINKS.source} ${AUTHORS.source})*\\)(\n.*)*`
);

export function validateEntry(entry: string): Error[] | void {
  if (!entry.match(ENTRY_REGEX)) {
    return [new Error('Invalid changelog entry, check formatting')];
  }

  const errors: Error[] = [];

  const commitsOrPRs = nullthrows(entry.match(new RegExp(COMMIT_OR_PR_LINK, 'g')));
  for (const commitOrPR of commitsOrPRs) {
    const maybeError = validateCommitOrPR(commitOrPR);
    if (maybeError) {
      errors.push(maybeError);
    }
  }

  const authors = nullthrows(entry.match(new RegExp(AUTHOR_LINK, 'g')));
  for (const author of authors) {
    const maybeError = validateAuthor(author);
    if (maybeError) {
      errors.push(maybeError);
    }
  }

  if (errors.length > 0) {
    return errors;
  }
}

function validateCommitOrPR(commitOrPR: string): Error | void {
  const matched = commitOrPR.match(COMMIT_OR_PR_LINK_GROUPS);
  const { number, path } = nullthrows(matched?.groups);
  if (number.startsWith('#')) {
    const prNumber = number.slice(1);
    if (`pull/${prNumber}` !== path) {
      return new Error('The PR number does not match the URL');
    }
  } else {
    if (!path.startsWith(`commit/${number}`)) {
      return new Error('The commit hash does not match the URL');
    }
  }
}

function validateAuthor(author: string): Error | void {
  const matched = author.match(AUTHOR_LINK_GROUPS);
  const { author1, author2 } = nullthrows(matched?.groups);
  if (author1 !== author2) {
    return new Error(
      `The URL and user handle should point at the same user, ${author1} !== ${author2}`
    );
  }
}
