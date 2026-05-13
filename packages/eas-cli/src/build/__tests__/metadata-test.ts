import { truncateGitCommitMessage } from '../metadata';

describe(truncateGitCommitMessage, () => {
  it('returns undefined if no message was passed', () => {
    expect(truncateGitCommitMessage(undefined)).toBeUndefined();
  });
  it('returns commit message', () => {
    expect(truncateGitCommitMessage('a'.repeat(10))).toBe('a'.repeat(10));
  });

  it('truncates long commit messages', () => {
    expect(truncateGitCommitMessage('a'.repeat(5000))).toBe(`${'a'.repeat(4093)}...`);
  });
});
