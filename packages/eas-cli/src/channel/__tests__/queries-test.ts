import { renderChannelHeaderContent } from '../queries';
import Log from '../../log';

jest.mock('../../log');

describe(renderChannelHeaderContent.name, () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it.each([
    [true, 'Protected'],
    [false, 'Unprotected'],
  ])('renders protection state when isProtected is %s', (isProtected, expected) => {
    renderChannelHeaderContent({
      channelName: 'production',
      channelId: 'channel-id',
      isPaused: false,
      isProtected,
    });

    const output = jest.mocked(Log.log).mock.calls.flat().join('\n');
    expect(output).toContain('Protection');
    expect(output).toContain(expected);
  });
});
