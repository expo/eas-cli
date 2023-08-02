import { testBasicChannelInfo, testBasicChannelInfo2 } from '../../../channel/__tests__/fixtures';
import { getChannelsDatasetAsync } from '../../../channel/queries';
import { createCtxMock } from '../../../eas-update/__tests__/fixtures';
import { NonInteractiveError } from '../../../eas-update/utils';
import { promptAsync } from '../../../prompts';
import { standardBranchMapping } from '../../__tests__/fixtures';
import { SelectRollout } from '../SelectRollout';

jest.mock('../../../channel/queries');
jest.mock('../../../prompts');
describe(SelectRollout, () => {
  afterEach(() => {
    jest.clearAllMocks();
  });
  it('returns null if project has no rollouts', async () => {
    jest.mocked(getChannelsDatasetAsync).mockResolvedValue([]);
    const ctx = createCtxMock();
    const selectRollout = new SelectRollout();
    const rollout = await selectRollout.runAsync(ctx);
    expect(rollout).toBeNull();
  });
  it('returns the rollout without prompting if project only one rollout', async () => {
    jest.mocked(getChannelsDatasetAsync).mockResolvedValue([testBasicChannelInfo]);
    const ctx = createCtxMock();
    const selectRollout = new SelectRollout();
    const rollout = await selectRollout.runAsync(ctx);
    expect(rollout).toBe(testBasicChannelInfo);
  });
  it('returns the selected rollout', async () => {
    jest
      .mocked(getChannelsDatasetAsync)
      .mockResolvedValue([testBasicChannelInfo, testBasicChannelInfo2]);
    jest.mocked(promptAsync).mockImplementation(async () => ({
      channel: testBasicChannelInfo,
    }));
    const ctx = createCtxMock();
    const selectRollout = new SelectRollout();
    const rollout = await selectRollout.runAsync(ctx);
    expect(rollout).toBe(testBasicChannelInfo);
  });
  it('filters the channels for rollouts', async () => {
    const standardBranchMappingChannel = { ...testBasicChannelInfo };
    standardBranchMappingChannel.branchMapping = JSON.stringify(standardBranchMapping);
    const mockDataset = [standardBranchMappingChannel];
    jest.mocked(getChannelsDatasetAsync).mockImplementation((_gqlClient, args: any) => {
      const filterPredicate = args.filterPredicate as any;
      return mockDataset.filter(filterPredicate) as any;
    });
    const ctx = createCtxMock();
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
