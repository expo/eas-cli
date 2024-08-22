import { EASUpdateAction, EASUpdateContext, NonInteractiveError } from '../../eas-update/utils';
import { UpdateBranchBasicInfoFragment } from '../../graphql/generated';
import { BranchQuery } from '../../graphql/queries/BranchQuery';
import {
  Connection,
  Edge,
  FilterPagination,
  QueryParams,
  selectPaginatedAsync,
} from '../../utils/relay';

/**
 * Select a branch for the project.
 *
 * @constructor
 * @param {function} options.filterPredicate - A predicate to filter the branches that are shown to the user. It takes a branchInfo object as a parameter and returns a boolean.
 * @param {string} options.printedType - The type of branch printed to the user. Defaults to 'branch'.
 * @param {number} options.pageSize - The number of branches to show per page. Defaults to 100.
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
export class SelectBranch implements EASUpdateAction<UpdateBranchBasicInfoFragment | null> {
  constructor(
    private readonly options: {
      filterPredicate?: (branchInfo: UpdateBranchBasicInfoFragment) => boolean;
      printedType?: string;
      pageSize?: number;
      beforeEachFilterQuery?: (
        externalQueryParams: QueryParams,
        totalNodesFetched: number,
        dataset: Edge<UpdateBranchBasicInfoFragment>[]
      ) => void;
      afterEachFilterQuery?: (
        externalQueryParams: QueryParams,
        totalNodesFetched: number,
        dataset: Edge<UpdateBranchBasicInfoFragment>[],
        willFetchAgain: boolean
      ) => void;
    } = {}
  ) {}

  async queryAsync(
    ctx: EASUpdateContext,
    queryParams: QueryParams
  ): Promise<Connection<UpdateBranchBasicInfoFragment>> {
    const { graphqlClient, app } = ctx;
    const { projectId } = app;
    return await BranchQuery.listBranchesBasicInfoPaginatedOnAppAsync(graphqlClient, {
      appId: projectId,
      ...queryParams,
    });
  }

  async filterQueryAsync(
    ctx: EASUpdateContext,
    queryParams: QueryParams,
    filterPredicate: (branchInfo: UpdateBranchBasicInfoFragment) => boolean
  ): Promise<Connection<UpdateBranchBasicInfoFragment>> {
    const queryAsync = async (
      queryParams: QueryParams
    ): Promise<Connection<UpdateBranchBasicInfoFragment>> =>
      await this.queryAsync(ctx, queryParams);
    return await FilterPagination.getPageAsync({
      queryParams,
      queryAsync,
      filterPredicate,
      beforeEachQuery: this.options.beforeEachFilterQuery,
      afterEachQuery: this.options.afterEachFilterQuery,
    });
  }

  public async runAsync(ctx: EASUpdateContext): Promise<UpdateBranchBasicInfoFragment | null> {
    const { nonInteractive } = ctx;
    const { filterPredicate } = this.options;
    const printedType = this.options.printedType ?? 'branch';
    const pageSize = this.options.pageSize ?? 100;
    if (nonInteractive) {
      throw new NonInteractiveError(
        `${printedType} selection cannot be run in non-interactive mode.`
      );
    }

    const queryAsync = async (
      queryParams: QueryParams
    ): Promise<Connection<UpdateBranchBasicInfoFragment>> =>
      filterPredicate
        ? await this.filterQueryAsync(ctx, queryParams, filterPredicate)
        : await this.queryAsync(ctx, queryParams);

    const getTitleAsync = async (branchInfo: UpdateBranchBasicInfoFragment): Promise<string> =>
      branchInfo.name;

    return await selectPaginatedAsync({
      queryAsync,
      getTitleAsync,
      printedType,
      pageSize,
    });
  }
}
