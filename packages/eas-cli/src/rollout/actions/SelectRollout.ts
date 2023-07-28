import { SelectChannel } from '../../channel/actions/SelectChannel';
import { getBranchMapping } from '../../channel/branch-mapping';
import { EASUpdateAction, EASUpdateContext } from '../../eas-update/utils';
import { UpdateChannelBasicInfoFragment } from '../../graphql/generated';
import { isRollout } from '../branch-mapping';

/**
 * Select an existing rollout for the project.
 */
export class SelectRollout implements EASUpdateAction<UpdateChannelBasicInfoFragment | null> {
  public async runAsync(ctx: EASUpdateContext): Promise<UpdateChannelBasicInfoFragment | null> {
    const rolloutFilterPredicate = (channelInfo: UpdateChannelBasicInfoFragment): boolean => {
      const branchMapping = getBranchMapping(channelInfo.branchMapping);
      return isRollout(branchMapping);
    };
    const selectChannel = new SelectChannel({
      printedType: 'rollout',
      filterPredicate: rolloutFilterPredicate,
    });
    return await selectChannel.runAsync(ctx);
  }
}
