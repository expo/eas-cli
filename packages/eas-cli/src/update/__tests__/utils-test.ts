import { getPlatformsForGroup, truncateString } from '../utils';

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
});
