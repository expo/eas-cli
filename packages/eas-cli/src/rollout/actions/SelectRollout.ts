import { SelectChannel } from '../../channel/actions/SelectChannel';
import { EASUpdateAction, EASUpdateContext } from '../../eas-update/utils';
import { UpdateChannelBasicInfoFragment } from '../../graphql/generated';
import { Ora, ora } from '../../ora';
import { Edge, QueryParams } from '../../utils/relay';
import { isRollout } from '../branch-mapping';

/**
 * Select an existing rollout for the project.
 */
export class SelectRollout implements EASUpdateAction<UpdateChannelBasicInfoFragment | null> {
  public async runAsync(ctx: EASUpdateContext): Promise<UpdateChannelBasicInfoFragment | null> {
    let assetSpinner: Ora | null = null;
    const afterEachFilterQuery = (
      _externalQueryParams: QueryParams,
      totalNodesFetched: number,
      _dataset: Edge<UpdateChannelBasicInfoFragment>[],
      willFetchAgain: boolean
    ): void => {
      if (willFetchAgain && !assetSpinner) {
        assetSpinner = ora().start('Fetching channels...');
      }
      if (assetSpinner) {
        assetSpinner.text = `Fetched ${totalNodesFetched} channels`;
      }
    };
    const selectChannelAction = new SelectChannel({
      printedType: 'rollout',
      filterPredicate: isRollout,
      afterEachFilterQuery,
    });
    const channelInfo = await selectChannelAction.runAsync(ctx);
    if (assetSpinner) {
      (assetSpinner as Ora).succeed(`Fetched all channels`);
    }
    return channelInfo;
  }
}
