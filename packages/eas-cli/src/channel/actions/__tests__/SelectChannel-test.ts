import { createCtxMock } from '../../../eas-update/__tests__/fixtures';
import { NonInteractiveError } from '../../../eas-update/utils';
import { UpdateChannelBasicInfoFragment } from '../../../graphql/generated';
import { ChannelQuery } from '../../../graphql/queries/ChannelQuery';
import { promptAsync } from '../../../prompts';
import { testBasicChannelInfo, testBasicChannelInfo2 } from '../../__tests__/fixtures';
import { SelectChannel } from '../SelectChannel';

jest.mock('../../../prompts');
jest.mock('../../../graphql/queries/ChannelQuery');
describe(SelectChannel, () => {
  afterEach(() => {
    jest.clearAllMocks();
  });
  it('returns null if project has no channels', async () => {
    const ctx = createCtxMock();
    jest.mocked(ChannelQuery.viewUpdateChannelsBasicInfoPaginatedOnAppAsync).mockResolvedValue({
      edges: [],
      pageInfo: {
        hasPreviousPage: false,
        hasNextPage: false,
      },
    });
    const selectChannel = new SelectChannel();
    const channel = await selectChannel.runAsync(ctx);
    expect(channel).toBeNull();
  });
  it('still prompts if project has only one channel', async () => {
    const ctx = createCtxMock();
    jest.mocked(ChannelQuery.viewUpdateChannelsBasicInfoPaginatedOnAppAsync).mockResolvedValue({
      edges: [{ node: testBasicChannelInfo, cursor: 'cursor' }],
      pageInfo: {
        hasPreviousPage: false,
        hasNextPage: false,
      },
    });
    jest.mocked(promptAsync).mockImplementation(async () => ({
      item: testBasicChannelInfo,
    }));
    const selectChannel = new SelectChannel();
    const channel = await selectChannel.runAsync(ctx);
    expect(channel).toBe(testBasicChannelInfo);
    expect(promptAsync).toHaveBeenCalledTimes(1);
  });
  it('returns the selected channel', async () => {
    jest.mocked(ChannelQuery.viewUpdateChannelsBasicInfoPaginatedOnAppAsync).mockResolvedValue({
      edges: [
        { node: testBasicChannelInfo, cursor: 'cursor' },
        { node: testBasicChannelInfo2, cursor: 'cursor' },
      ],
      pageInfo: {
        hasPreviousPage: false,
        hasNextPage: false,
      },
    });
    jest.mocked(promptAsync).mockImplementation(async () => ({
      item: testBasicChannelInfo,
    }));
    const ctx = createCtxMock();
    const selectChannel = new SelectChannel();
    const channel = await selectChannel.runAsync(ctx);
    expect(channel).toBe(testBasicChannelInfo);
  });
  it('returns the only available channel with a filter', async () => {
    jest.mocked(ChannelQuery.viewUpdateChannelsBasicInfoPaginatedOnAppAsync).mockResolvedValue({
      edges: [
        { node: testBasicChannelInfo, cursor: 'cursor' },
        { node: testBasicChannelInfo2, cursor: 'cursor' },
      ],
      pageInfo: {
        hasPreviousPage: false,
        hasNextPage: false,
      },
    });
    const ctx = createCtxMock();
    const selectChannel = new SelectChannel({
      filterPredicate: (channelInfo: UpdateChannelBasicInfoFragment) =>
        channelInfo === testBasicChannelInfo,
    });
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
