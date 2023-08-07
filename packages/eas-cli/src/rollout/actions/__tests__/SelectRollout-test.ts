import { testBasicChannelInfo, testBasicChannelInfo2 } from '../../../channel/__tests__/fixtures';
import { createCtxMock } from '../../../eas-update/__tests__/fixtures';
import { NonInteractiveError } from '../../../eas-update/utils';
import { ChannelQuery } from '../../../graphql/queries/ChannelQuery';
import { promptAsync } from '../../../prompts';
import { standardBranchMapping } from '../../__tests__/fixtures';
import { SelectRollout } from '../SelectRollout';

jest.mock('../../../prompts');
jest.mock('../../../graphql/queries/ChannelQuery');
describe(SelectRollout, () => {
  afterEach(() => {
    jest.clearAllMocks();
  });
  it('returns null if project has no rollouts', async () => {
    const ctx = createCtxMock();
    jest.mocked(ChannelQuery.viewUpdateChannelsBasicInfoPaginatedOnAppAsync).mockResolvedValue({
      edges: [],
      pageInfo: {
        hasPreviousPage: false,
        hasNextPage: false,
      },
    });
    const selectRollout = new SelectRollout();
    const rollout = await selectRollout.runAsync(ctx);
    expect(rollout).toBeNull();
  });
  it('still prompts if project has only one rollout', async () => {
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
    const selectRollout = new SelectRollout();
    const rollout = await selectRollout.runAsync(ctx);
    expect(rollout).toBe(testBasicChannelInfo);
    expect(promptAsync).toHaveBeenCalledTimes(1);
  });
  it('returns the selected rollout', async () => {
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
    const selectRollout = new SelectRollout();
    const rollout = await selectRollout.runAsync(ctx);
    expect(rollout).toBe(testBasicChannelInfo);
  });
  it('filters the channels for rollouts', async () => {
    const standardBranchMappingChannel = { ...testBasicChannelInfo };
    standardBranchMappingChannel.branchMapping = JSON.stringify(standardBranchMapping);
    const ctx = createCtxMock();
    jest.mocked(ChannelQuery.viewUpdateChannelsBasicInfoPaginatedOnAppAsync).mockResolvedValue({
      edges: [{ node: standardBranchMappingChannel, cursor: 'cursor' }],
      pageInfo: {
        hasPreviousPage: false,
        hasNextPage: false,
      },
    });
    const selectRollout = new SelectRollout();
    const rollout = await selectRollout.runAsync(ctx);
    expect(rollout).toBeNull();
  });
  it('throws an error in Non-Interactive Mode', async () => {
    const ctx = createCtxMock({
      nonInteractive: true,
    });
    const selectRollout = new SelectRollout();

    // dont fail if users are running in non-interactive mode
    await expect(selectRollout.runAsync(ctx)).rejects.toThrowError(NonInteractiveError);
  });
});
