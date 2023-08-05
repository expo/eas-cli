import assert from 'assert';
import chalk from 'chalk';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { EASUpdateAction, EASUpdateContext, NonInteractiveError } from '../../eas-update/utils';
import { RuntimeFragment, UpdateBranchBasicInfoFragment } from '../../graphql/generated';
import { RuntimeQuery } from '../../graphql/queries/RuntimeQuery';
import { UpdateQuery } from '../../graphql/queries/UpdateQuery';
import Log, { learnMore } from '../../log';
import { confirmAsync } from '../../prompts';
import { Connection, QueryParams, selectPaginatedAsync } from '../../utils/relay';
import { formatRuntimeWithUpdateGroup } from '../utils';

/**
 * Select a runtime from a branch
 */
export class SelectRuntime implements EASUpdateAction<string | null> {
  private printedType;
  constructor(
    private branchInfo: UpdateBranchBasicInfoFragment,
    private options: {
      anotherBranchToIntersectRuntimesBy?: UpdateBranchBasicInfoFragment;
    } = {}
  ) {
    this.printedType = options.anotherBranchToIntersectRuntimesBy
      ? `compatible runtime`
      : `runtime`;
  }

  warnNoRuntime(): void {
    if (this.options.anotherBranchToIntersectRuntimesBy) {
      const intersectBranchName = this.options.anotherBranchToIntersectRuntimesBy.name;
      Log.warn(
        `⚠️  Branches ${this.branchInfo.name} and ${intersectBranchName} dont have any updates with the same runtime.`
      );
      // TODO(quin): write a learn more
      Log.warn(`Your updates could be misconfigured. ${learnMore('https://expo.fyi/todo')}`);
    } else {
      // no runtime on branch means no updates published on branch
      Log.warn(`⚠️  There are no updates published on branch ${this.branchInfo.name}.`);
    }
  }

  formatCantFindRuntime(): string {
    return `🕵️ Not finding the update you were looking for? ${learnMore('https://expo.fyi/todo')}`;
  }

  public async runAsync(ctx: EASUpdateContext): Promise<string | null> {
    const { nonInteractive, graphqlClient, app } = ctx;
    const { projectId } = app;
    if (nonInteractive) {
      throw new NonInteractiveError(`runtime selection cannot be run in non-interactive mode.`);
    }

    const newestRuntimeConnection = await this.getNewestRuntimeAsync(graphqlClient, {
      appId: projectId,
      branchName: this.branchInfo.name,
      anotherBranchIdToIntersectRuntimesBy: this.options.anotherBranchToIntersectRuntimesBy?.id,
    });

    if (!newestRuntimeConnection) {
      Log.addNewLineIfNone();
      this.warnNoRuntime();
      return null;
    }

    const moreThanOneRuntime = newestRuntimeConnection.edges.length > 1;
    Log.log(`✅ ${beginSentence(this.printedType)}${moreThanOneRuntime ? 's' : ''} detected`);

    if (!moreThanOneRuntime) {
      const runtime = newestRuntimeConnection.edges[0].node;
      const formattedRuntimeWithGroup = await this.displayLatestUpdateGroupAsync({
        graphqlClient,
        appId: projectId,
        branchName: this.branchInfo.name,
        runtime,
      });
      Log.addNewLineIfNone();
      Log.log(formattedRuntimeWithGroup);
      Log.addNewLineIfNone();
      const useRuntime = await confirmAsync({
        message: `Target ${this.printedType} ${chalk.bold(runtime.version)}?`,
      });
      if (useRuntime) {
        return runtime.version;
      } else {
        Log.newLine();
        Log.warn(this.formatCantFindRuntime());
        return null;
      }
    }

    Log.log(this.formatCantFindRuntime());
    const selectedRuntime = await this.selectRuntimesAsync(graphqlClient, {
      appId: projectId,
    });
    if (!selectedRuntime) {
      throw new Error(`No ${this.printedType} selected`);
    }
    return selectedRuntime.version;
  }

  async getNewestRuntimeAsync(
    graphqlClient: ExpoGraphqlClient,
    {
      appId,
      branchName,
      anotherBranchIdToIntersectRuntimesBy,
    }: {
      appId: string;
      branchName: string;
      anotherBranchIdToIntersectRuntimesBy?: string;
    }
  ): Promise<Connection<RuntimeFragment> | null> {
    const connection = await RuntimeQuery.getRuntimesOnBranchAsync(graphqlClient, {
      appId,
      name: branchName,
      first: 2,
      filter: {
        branchId: anotherBranchIdToIntersectRuntimesBy,
      },
    });
    const { edges } = connection;
    if (edges.length === 0) {
      return null;
    }
    return connection;
  }

  async displayLatestUpdateGroupAsync({
    graphqlClient,
    appId,
    branchName,
    runtime,
  }: {
    graphqlClient: ExpoGraphqlClient;
    appId: string;
    branchName: string;
    runtime: RuntimeFragment;
  }): Promise<string> {
    const updateGroups = await UpdateQuery.viewUpdateGroupsOnBranchAsync(graphqlClient, {
      appId,
      branchName,
      limit: 1,
      offset: 0,
      filter: {
        runtimeVersions: [runtime.version],
      },
    });
    assert(
      updateGroups.length < 2,
      `Expected at most one update group. Received: ${JSON.stringify(updateGroups)}`
    );
    return formatRuntimeWithUpdateGroup(updateGroups[0], runtime, branchName);
  }

  async selectRuntimesAsync(
    graphqlClient: ExpoGraphqlClient,
    {
      appId,
      batchSize = 5,
    }: {
      appId: string;
      batchSize?: number;
    }
  ): Promise<RuntimeFragment | null> {
    const queryAsync = async (queryParams: QueryParams): Promise<Connection<RuntimeFragment>> => {
      return await RuntimeQuery.getRuntimesOnBranchAsync(graphqlClient, {
        appId,
        name: this.branchInfo.name,
        first: queryParams.first,
        after: queryParams.after,
        last: queryParams.last,
        before: queryParams.before,
        filter: {
          branchId: this.options.anotherBranchToIntersectRuntimesBy?.id,
        },
      });
    };
    const getTitleAsync = async (runtime: RuntimeFragment): Promise<string> => {
      return await this.displayLatestUpdateGroupAsync({
        graphqlClient,
        appId,
        branchName: this.branchInfo.name,
        runtime,
      });
    };
    return await selectPaginatedAsync({
      queryAsync,
      getTitleAsync,
      printedType: 'target runtime',
      pageSize: batchSize,
    });
  }
}

function beginSentence(phrase: string): string {
  if (typeof phrase !== 'string' || phrase.length === 0) {
    return phrase; // Return the input without any modification if it's not a string or empty
  }
  return phrase.charAt(0).toUpperCase() + phrase.slice(1);
}
