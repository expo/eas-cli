import { testBasicChannelInfo, testChannelObject } from '../../../channel/__tests__/fixtures';
import { getAlwaysTrueBranchMapping, getBranchMapping } from '../../../channel/branch-mapping';
import { updateChannelBranchMappingAsync } from '../../../commands/channel/edit';
import { createCtxMock } from '../../../eas-update/__tests__/fixtures';
import { ChannelQuery } from '../../../graphql/queries/ChannelQuery';
import { confirmAsync } from '../../../prompts';
import { RolloutBranchMapping, editRolloutBranchMapping } from '../../branch-mapping';
import { EditRollout } from '../EditRollout';

jest.mock('../../../prompts');
jest.mock('../../../graphql/queries/ChannelQuery');
jest.mock('../../../commands/channel/edit');
describe(EditRollout, () => {
  afterEach(() => {
    jest.clearAllMocks();
  });
  it('throws if the channel doesnt have an active rollout', async () => {
    const ctx = createCtxMock();
    const editRollout = new EditRollout({
      ...testBasicChannelInfo,
      branchMapping: JSON.stringify(getAlwaysTrueBranchMapping('test-branch')),
    });
    await expect(editRollout.runAsync(ctx)).rejects.toThrowError('is not a rollout');
  });
  it('edits the channel with an active rollout', async () => {
    const ctx = createCtxMock();
    jest.mocked(ChannelQuery.viewUpdateChannelAsync).mockResolvedValue(testChannelObject);
    jest.mocked(updateChannelBranchMappingAsync).mockResolvedValue(testChannelObject);
    jest.mocked(confirmAsync).mockImplementation(async () => true);
    const editRollout = new EditRollout(testChannelObject, { percent: 50 });
    await editRollout.runAsync(ctx);
    expect(updateChannelBranchMappingAsync).toBeCalledWith(
      expect.any(Function),
      expect.objectContaining({
        branchMapping: JSON.stringify(
          editRolloutBranchMapping(
            getBranchMapping(testChannelObject.branchMapping) as RolloutBranchMapping,
            50
          )
        ),
      })
    );
  });
  it('works in Non-Interactive Mode', async () => {
    const ctx = createCtxMock({
      nonInteractive: true,
    });
    jest.mocked(ChannelQuery.viewUpdateChannelAsync).mockResolvedValue(testChannelObject);
    jest.mocked(updateChannelBranchMappingAsync).mockResolvedValue(testChannelObject);
    jest.mocked(confirmAsync).mockImplementation(async () => true);
    const editRollout = new EditRollout(testChannelObject, { percent: 50 });
    await editRollout.runAsync(ctx);
    expect(updateChannelBranchMappingAsync).toBeCalledWith(
      expect.any(Function),
      expect.objectContaining({
        branchMapping: JSON.stringify(
          editRolloutBranchMapping(
            getBranchMapping(testChannelObject.branchMapping) as RolloutBranchMapping,
            50
          )
        ),
      })
    );
  });
});
