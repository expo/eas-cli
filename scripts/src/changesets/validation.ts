import { parseChangesetFile } from '@changesets/parse';
import { execFileSync } from 'node:child_process';

import { validateSummary } from '../../../.changeset/formatEntry.mjs';

export function validateChangeset(
  file: string,
  contents: string,
  packageNames: ReadonlySet<string>
): string[] {
  let changeset: ReturnType<typeof parseChangesetFile>;
  try {
    changeset = parseChangesetFile(contents);
  } catch (error) {
    return [`${file}: cannot parse the changeset. ${(error as Error).message}`];
  }
  const errors: string[] = [];
  try {
    validateSummary(changeset.summary);
  } catch (error) {
    errors.push(`${file}: ${(error as Error).message}`);
  }
  for (const release of changeset.releases) {
    if (!packageNames.has(release.name)) {
      errors.push(`${file}: "${release.name}" is not a package in packages/.`);
    }
  }
  return errors;
}

export function hasChangelogContentChanges(baseRef: string, file: string, cwd: string): boolean {
  // Permit blank-line repairs, but keep generated changelog text protected.
  return (
    execFileSync('git', ['diff', '--ignore-blank-lines', `${baseRef}...HEAD`, '--', file], {
      cwd,
      encoding: 'utf8',
    }).length > 0
  );
}
