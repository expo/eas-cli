import { SelectChannel } from '../../channel/actions/SelectChannel';
import { EASUpdateAction, EASUpdateContext } from '../../eas-update/utils';
import { UpdateChannelBasicInfoFragment } from '../../graphql/generated';
import { isRollout } from '../branch-mapping';

/**
 * Select an existing rollout for the project.
 */
export class SelectRollout implements EASUpdateAction<UpdateChannelBasicInfoFragment | null> {
  public async runAsync(ctx: EASUpdateContext): Promise<UpdateChannelBasicInfoFragment | null> {
    const selectChannel = new SelectChannel({
      printedType: 'rollout',
      filterPredicate: isRollout,
    });
    return await selectChannel.runAsync(ctx);
  }
}
