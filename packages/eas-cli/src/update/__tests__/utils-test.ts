import { UpdateFragment } from '../../graphql/generated';
import { getPlatformsForGroup, getUpdateJsonInfosForUpdates, truncateString } from '../utils';

function makeUpdate(overrides: Partial<UpdateFragment> = {}): UpdateFragment {
  return {
    id: 'update-1',
    group: 'group-1',
    message: 'a message',
    createdAt: '2026-01-01T00:00:00Z',
    platform: 'ios',
    manifestFragment: '{}',
    isRollBackToEmbedded: false,
    manifestPermalink: 'https://expo.dev/manifest',
    gitCommitHash: 'abc123',
    isGitWorkingTreeDirty: false,
    branch: { id: 'branch-1', name: 'main' },
    runtime: { id: 'runtime-1', version: '1.0.0' },
    ...overrides,
  } as UpdateFragment;
}

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

  describe(getUpdateJsonInfosForUpdates, () => {
    it('includes the signed assetMapUrl when the update has an asset map', () => {
      const [info] = getUpdateJsonInfosForUpdates([
        makeUpdate({ assetMapUrl: 'https://storage.example/assetmap.json?signature' }),
      ]);

      expect(info.assetMapUrl).toBe('https://storage.example/assetmap.json?signature');
    });

    it.each([[null], [undefined]])(
      'reports assetMapUrl as null when the server returns %p',
      assetMapUrl => {
        const [info] = getUpdateJsonInfosForUpdates([makeUpdate({ assetMapUrl })]);

        expect(info.assetMapUrl).toBeNull();
      }
    );
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
});
