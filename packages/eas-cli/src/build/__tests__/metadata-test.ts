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

  it('does not leave a split emoji (lone surrogate) at the truncation boundary', () => {
    const message = 'a'.repeat(4092) + '🎉' + 'b'.repeat(10);
    expect(truncateGitCommitMessage(message)).toBe(`${'a'.repeat(4092)}...`);
  });

  it('keeps a complete emoji that ends exactly at the truncation boundary', () => {
    const message = 'a'.repeat(4091) + '🎉' + 'b'.repeat(10);
    expect(truncateGitCommitMessage(message)).toBe(`${'a'.repeat(4091)}🎉...`);
  });

  it('preserves emoji before the truncation boundary', () => {
    const message = '🎉' + 'a'.repeat(5000);
    expect(truncateGitCommitMessage(message)).toBe(`🎉${'a'.repeat(4091)}...`);
  });
});
