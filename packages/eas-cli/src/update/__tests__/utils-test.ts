import { truncatePublishUpdateMessage } from '../../commands/update';
import Log from '../../log';
import { getPlatformsForGroup } from '../utils';

describe('update utility functions', () => {
  describe(truncatePublishUpdateMessage.name, () => {
    const warnSpy = jest.spyOn(Log, 'warn');
    beforeEach(() => {
      warnSpy.mockClear();
    });

    it('does not alter messages with less than 1024 characters', () => {
      const message = 'Small message =)';
      const truncatedMessage = truncatePublishUpdateMessage(message);
      expect(truncatedMessage).toEqual(message);
      expect(warnSpy).not.toBeCalled();
    });

    it('truncates messages to a length of 1024, including ellipses', () => {
      const longMessage = Array.from({ length: 2024 }, () => 'a').join('');
      const truncatedMessage = truncatePublishUpdateMessage(longMessage);
      expect(truncatedMessage.length).toEqual(1024);
      expect(truncatedMessage.slice(-3)).toEqual('...');
      expect(warnSpy).toBeCalledWith(
        'Update message exceeds the allowed 1024 character limit. Truncating message...'
      );
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
