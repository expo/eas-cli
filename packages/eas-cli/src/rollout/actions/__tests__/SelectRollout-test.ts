import { testBasicChannelInfo } from '../../../channel/__tests__/fixtures';
import { createCtxMock } from '../../../eas-update/__tests__/fixtures';
import { NonInteractiveError } from '../../../eas-update/utils';
import { promptAsync } from '../../../prompts';
import { standardBranchMapping } from '../../__tests__/fixtures';
import { SelectRollout } from '../SelectRollout';

jest.mock('../../../prompts');
describe(SelectRollout, () => {
  afterEach(() => {
    jest.clearAllMocks();
  });
  it('returns null if project has no rollouts', async () => {
    const ctx = createCtxMock();
    const selectRollout = new SelectRollout();
    const rollout = await selectRollout.runAsync(ctx);
    expect(rollout).toBeNull();
  });
  it('returns the rollout without prompting if project only one rollout', async () => {
    const ctx = createCtxMock();
    const selectRollout = new SelectRollout();
    const rollout = await selectRollout.runAsync(ctx);
    expect(rollout).toBe(testBasicChannelInfo);
  });
  it('returns the selected rollout', async () => {
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
