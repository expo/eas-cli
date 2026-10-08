import { getCommitInfo } from '@changesets/get-github-info';

import { formatEntry } from './formatEntry.mjs';

const REPO = 'expo/eas-cli';

/**
 * Returns the PR and author links for the commit that added a changeset.
 *
 * @param {{ id: string, commit?: string }} changeset
 * @returns {Promise<string>} For example `([#123](https://...) by [@user](https://...))`.
 */
export async function getAttributionAsync(changeset) {
  if (!changeset.commit) {
    throw new Error(
      `Changeset .changeset/${changeset.id}.md is not committed. Commit it, then run the release again.`
    );
  }
  const info = await getCommitInfo({ repo: REPO, commit: changeset.commit });
  if (info?.pull && info.author) {
    return `(${info.pull.markdownLink} by ${info.author.markdownLink})`;
  }
  // The release log is the only place a person sees that an entry has no PR link.
  // eslint-disable-next-line no-console
  console.warn(
    `No pull request found on GitHub for commit ${changeset.commit} (changeset ${changeset.id}). The entry links the commit instead.`
  );
  const commitLink =
    info?.commit.markdownLink ??
    `[\`${changeset.commit.slice(0, 7)}\`](https://github.com/${REPO}/commit/${changeset.commit})`;
  return info?.author ? `(${commitLink} by ${info.author.markdownLink})` : `(${commitLink})`;
}

/**
 * @param {{ id: string, summary: string, commit?: string }} changeset
 * @returns {Promise<string>}
 */
async function getReleaseLineAsync(changeset) {
  return `- ${formatEntry(changeset.summary, await getAttributionAsync(changeset))}`;
}

/** @type {import('@changesets/types').ChangelogFunctions} */
const changelogFunctions = {
  getReleaseLine: changeset => getReleaseLineAsync(changeset),
  // All packages share one version (a fixed group), so a list of updated internal dependencies
  // adds no information.
  getDependencyReleaseLine: () => Promise.resolve(''),
};

export default changelogFunctions;
