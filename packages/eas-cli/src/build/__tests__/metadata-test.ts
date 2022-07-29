import { instance, mock, when } from 'ts-mockito';

import { Client } from '../../vcs/vcs';
import { getFormattedCommitMessageAsync } from '../metadata';

describe(getFormattedCommitMessageAsync, () => {
  it(`returns undefined if it's not a git project`, async () => {
    const clientMock = mock<Client>();
    when(clientMock.getLastCommitMessageAsync()).thenResolve(null);
    const client = instance(clientMock);

    await expect(getFormattedCommitMessageAsync(client)).resolves.toBe(undefined);
  });

  it('returns commit message', async () => {
    const clientMock = mock<Client>();
    when(clientMock.getLastCommitMessageAsync()).thenResolve('lorem ipsum');
    const client = instance(clientMock);

    await expect(getFormattedCommitMessageAsync(client)).resolves.toBe('lorem ipsum');
  });

  it('trims long commit messages', async () => {
    const clientMock = mock<Client>();
    when(clientMock.getLastCommitMessageAsync()).thenResolve('a'.repeat(1500));
    const client = instance(clientMock);

    await expect(getFormattedCommitMessageAsync(client)).resolves.toBe(`${'a'.repeat(1021)}...`);
  });

  it('replaces new lines with spaces', async () => {
    const clientMock = mock<Client>();
    when(clientMock.getLastCommitMessageAsync()).thenResolve(`Lorem\nipsum\ndolor\nsit\namet`);
    const client = instance(clientMock);

    await expect(getFormattedCommitMessageAsync(client)).resolves.toBe(
      `Lorem ipsum dolor sit amet`
    );
  });
});
