import { createCtxMock } from '../../../eas-update/__tests__/fixtures';
import { NonInteractiveError } from '../../../eas-update/utils';
import { promptAsync } from '../../../prompts';
import { testBasicChannelInfo, testBasicChannelInfo2 } from '../../__tests__/fixtures';
import { getChannelsDatasetAsync } from '../../queries';
import { SelectChannel } from '../SelectChannel';

jest.mock('../../queries');
jest.mock('../../../prompts');
describe(SelectChannel, () => {
  afterEach(() => {
    jest.clearAllMocks();
  });
  it('returns null if project has no channels', async () => {
    jest.mocked(getChannelsDatasetAsync).mockResolvedValue([]);
    const ctx = createCtxMock();
    const selectChannel = new SelectChannel();
    const channel = await selectChannel.runAsync(ctx);
    expect(channel).toBeNull();
  });
  it('returns the channel without prompting if project only one channel', async () => {
    jest.mocked(getChannelsDatasetAsync).mockResolvedValue([testBasicChannelInfo]);
    const ctx = createCtxMock();
    const selectChannel = new SelectChannel();
    const channel = await selectChannel.runAsync(ctx);
    expect(channel).toBe(testBasicChannelInfo);
  });
  it('returns the selected channel', async () => {
    jest
      .mocked(getChannelsDatasetAsync)
      .mockResolvedValue([testBasicChannelInfo, testBasicChannelInfo2]);
    jest.mocked(promptAsync).mockImplementation(async () => ({
      channel: testBasicChannelInfo,
    }));
    const ctx = createCtxMock();
    const selectChannel = new SelectChannel();
    const channel = await selectChannel.runAsync(ctx);
    expect(channel).toBe(testBasicChannelInfo);
  });
  it('throws an error in Non-Interactive Mode', async () => {
    const ctx = createCtxMock({
      nonInteractive: true,
    });
    const selectChannel = new SelectChannel();

    // dont fail if users are running in non-interactive mode
    await expect(selectChannel.runAsync(ctx)).rejects.toThrowError(NonInteractiveError);
  });
});
