import { instance, mock } from 'ts-mockito';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import fetch from '../../fetch';
import { UpdatePublishMutation } from '../../graphql/generated';
import { AssetQuery } from '../../graphql/queries/AssetQuery';
import { BranchQuery } from '../../graphql/queries/BranchQuery';
import { EmbeddedUpdateQuery } from '../../graphql/queries/EmbeddedUpdateQuery';
import { getPlatformsForGroup, prewarmDiffingAsync, truncateString } from '../utils';

jest.mock('../../fetch');
jest.mock('../../graphql/queries/AssetQuery');
jest.mock('../../graphql/queries/BranchQuery');
jest.mock('../../graphql/queries/EmbeddedUpdateQuery');

describe('update utility functions', () => {
  describe(truncateString, () => {
    it('does not alter messages with less than 1024 characters', () => {
      const message = 'Small message =)';
      const truncatedMessage = truncateString(message, 1024);
      expect(truncatedMessage).toEqual(message);
    });

    it('truncates messages to a length of 1024, including ellipses', () => {
      const longMessage = Array.from({ length: 2024 }, () => 'a').join('');
      const truncatedMessage = truncateString(longMessage, 1024);
      expect(truncatedMessage.length).toEqual(1024);
      expect(truncatedMessage.slice(-3)).toEqual('...');
    });
  });

  describe(getPlatformsForGroup.name, () => {
    it.each([
      { group: 'abc', updates: [] },
      { group: '', updates: [] },
      { group: undefined, updates: [] },
      { group: undefined, updates: undefined },
      { group: 'asdf', updates: undefined },
    ])(`returns 'N/A' updates are undefined or empty`, input => {
      expect(getPlatformsForGroup(input)).toEqual(`N/A`);
    });
  });

  describe(prewarmDiffingAsync, () => {
    const updateStub: UpdatePublishMutation['updateBranch']['publishUpdateGroups'][number] = {
      id: 'new-update-id',
      group: 'group-1234',
      createdAt: '2026-01-01T00:00:00Z',
      runtimeVersion: '1.0.0',
      platform: 'ios',
      manifestFragment: JSON.stringify({ launchAsset: { storageKey: 'launch-key' } }),
      isRollBackToEmbedded: false,
      manifestPermalink: 'https://expo.dev/fake/manifest/link',
      isGitWorkingTreeDirty: false,
      branch: { id: 'branch-1234', name: 'production' },
    };

    beforeEach(() => {
      jest.resetAllMocks();
      jest.mocked(fetch).mockResolvedValue({} as any);
    });

    it('warms the top-K recent updates and the embedded bundle', async () => {
      const graphqlClient = instance(mock<ExpoGraphqlClient>());
      jest.mocked(BranchQuery.getUpdateIdsOnBranchAsync).mockResolvedValue(['r1', 'r2']);
      jest
        .mocked(AssetQuery.getSignedUrlsAsync)
        .mockResolvedValue([{ storageKey: 'launch-key', url: 'https://cdn/asset', headers: {} }]);
      jest
        .mocked(EmbeddedUpdateQuery.viewPaginatedAsync)
        .mockResolvedValue({ edges: [{ cursor: 'c0', node: { id: 'e1' } }] } as any);

      const warmed = await prewarmDiffingAsync(graphqlClient, 'app-id', [updateStub]);

      // The embedded bundle diffs against itself; recent updates fall back to the first embedded id.
      expect(warmed).toEqual([
        { requestedUpdateId: 'new-update-id', currentUpdateId: 'e1', embeddedUpdateId: 'e1' },
        { requestedUpdateId: 'new-update-id', currentUpdateId: 'r1', embeddedUpdateId: 'e1' },
        { requestedUpdateId: 'new-update-id', currentUpdateId: 'r2', embeddedUpdateId: 'e1' },
      ]);
    });

    it('is best-effort: swallows errors and resolves to an empty list', async () => {
      const graphqlClient = instance(mock<ExpoGraphqlClient>());
      jest.mocked(BranchQuery.getUpdateIdsOnBranchAsync).mockRejectedValue(new Error('boom'));

      await expect(prewarmDiffingAsync(graphqlClient, 'app-id', [updateStub])).resolves.toEqual([]);
    });

    it('returns empty when there are no recent updates on the branch', async () => {
      const graphqlClient = instance(mock<ExpoGraphqlClient>());
      jest.mocked(BranchQuery.getUpdateIdsOnBranchAsync).mockResolvedValue([]);

      await expect(prewarmDiffingAsync(graphqlClient, 'app-id', [updateStub])).resolves.toEqual([]);
    });

    it('returns empty when there is no signed launch asset URL', async () => {
      const graphqlClient = instance(mock<ExpoGraphqlClient>());
      jest.mocked(BranchQuery.getUpdateIdsOnBranchAsync).mockResolvedValue(['r1']);
      jest.mocked(AssetQuery.getSignedUrlsAsync).mockResolvedValue([]);

      await expect(prewarmDiffingAsync(graphqlClient, 'app-id', [updateStub])).resolves.toEqual([]);
    });

    it('skips updates with no launch asset in the manifest', async () => {
      const graphqlClient = instance(mock<ExpoGraphqlClient>());

      await expect(
        prewarmDiffingAsync(graphqlClient, 'app-id', [
          { ...updateStub, manifestFragment: JSON.stringify({}) },
        ])
      ).resolves.toEqual([]);
    });
  });
});
