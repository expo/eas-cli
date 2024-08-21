import { EASUpdateAction, EASUpdateContext, NonInteractiveError } from '../../eas-update/utils';
import { UpdateChannelBasicInfoFragment } from '../../graphql/generated';
import { ChannelQuery } from '../../graphql/queries/ChannelQuery';
import {
  Connection,
  Edge,
  FilterPagination,
  QueryParams,
  selectPaginatedAsync,
} from '../../utils/relay';

/**
 * Select a channel for the project.
 *
 * @constructor
 * @param {function} options.filterPredicate - A predicate to filter the channels that are shown to the user. It takes a channelInfo object as a parameter and returns a boolean.
 * @param {string} options.printedType - The type of channel printed to the user. Defaults to 'channel'.
 * @param {number} options.pageSize - The number of channels to show per page. Defaults to 100.
 * @param {function} options.beforeEachFilterQuery Optional. If a filter predicate was specified, this callback function will be called before each query.
 * @args externalQueryParams The query params for the pagination.
 * @args totalNodesFetched The total number of nodes fetched so far.
 * @args dataset The dataset so far.
 * @param {function} options.afterEachFilterQuery Optional. If a filter predicate was specified, this callback function will be called after each query.
 * @args externalQueryParams The query params for the pagination.
 * @args totalNodesFetched The total number of nodes fetched so far.
 * @args dataset The dataset so far.
 * @args willFetchAgain If the query will fetch again to get a complete page.
 */
export class SelectChannel implements EASUpdateAction<UpdateChannelBasicInfoFragment | null> {
  constructor(
    private readonly options: {
      filterPredicate?: (channelInfo: UpdateChannelBasicInfoFragment) => boolean;
      printedType?: string;
      pageSize?: number;
      beforeEachFilterQuery?: (
        externalQueryParams: QueryParams,
        totalNodesFetched: number,
        dataset: Edge<UpdateChannelBasicInfoFragment>[]
      ) => void;
      afterEachFilterQuery?: (
        externalQueryParams: QueryParams,
        totalNodesFetched: number,
        dataset: Edge<UpdateChannelBasicInfoFragment>[],
        willFetchAgain: boolean
      ) => void;
    } = {}
  ) {}

  async queryAsync(
    ctx: EASUpdateContext,
    queryParams: QueryParams
  ): Promise<Connection<UpdateChannelBasicInfoFragment>> {
    const { graphqlClient, app } = ctx;
    const { projectId } = app;
    return await ChannelQuery.viewUpdateChannelsBasicInfoPaginatedOnAppAsync(graphqlClient, {
      appId: projectId,
      ...queryParams,
    });
  }

  async filterQueryAsync(
    ctx: EASUpdateContext,
    queryParams: QueryParams,
    filterPredicate: (channelInfo: UpdateChannelBasicInfoFragment) => boolean
  ): Promise<Connection<UpdateChannelBasicInfoFragment>> {
    const queryAsync = async (
      queryParams: QueryParams
    ): Promise<Connection<UpdateChannelBasicInfoFragment>> =>
      await this.queryAsync(ctx, queryParams);
    return await FilterPagination.getPageAsync({
      queryParams,
      queryAsync,
      filterPredicate,
      beforeEachQuery: this.options.beforeEachFilterQuery,
      afterEachQuery: this.options.afterEachFilterQuery,
    });
  }

  public async runAsync(ctx: EASUpdateContext): Promise<UpdateChannelBasicInfoFragment | null> {
    const { nonInteractive } = ctx;
    const { filterPredicate } = this.options;
    const printedType = this.options.printedType ?? 'channel';
    const pageSize = this.options.pageSize ?? 100;
    if (nonInteractive) {
      throw new NonInteractiveError(
        `${printedType} selection cannot be run in non-interactive mode.`
      );
    }

    const queryAsync = async (
      queryParams: QueryParams
    ): Promise<Connection<UpdateChannelBasicInfoFragment>> =>
      filterPredicate
        ? this.filterQueryAsync(ctx, queryParams, filterPredicate)
        : this.queryAsync(ctx, queryParams);

    const getTitleAsync = async (channelInfo: UpdateChannelBasicInfoFragment): Promise<string> =>
      channelInfo.name;

    return await selectPaginatedAsync({
      queryAsync,
      getTitleAsync,
      printedType,
      pageSize,
    });
  }
}
