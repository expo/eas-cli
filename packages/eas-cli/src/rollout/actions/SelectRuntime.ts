import assert from 'assert';
import chalk from 'chalk';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { EASUpdateAction, EASUpdateContext, NonInteractiveError } from '../../eas-update/utils';
import { RuntimeFragment, UpdateBranchBasicInfoFragment } from '../../graphql/generated';
import { RuntimeQuery } from '../../graphql/queries/RuntimeQuery';
import { UpdateQuery } from '../../graphql/queries/UpdateQuery';
import Log, { learnMore } from '../../log';
import { confirmAsync, promptAsync } from '../../prompts';
import { Connection, QueryParams, selectPaginatedAsync } from '../../utils/relay';
import { formatRuntimeWithUpdateGroup } from '../utils';

function beginSentence(phrase: string): string {
  if (typeof phrase !== 'string' || phrase.length === 0) {
    return phrase; // Return the input without any modification if it's not a string or empty
  }
  return phrase.charAt(0).toUpperCase() + phrase.slice(1);
}

/**
 * Select a runtime from a branch
 */
export class SelectRuntime implements EASUpdateAction<string> {
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

  public async runAsync(ctx: EASUpdateContext): Promise<string> {
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
      return await this.promptForRuntimeAsync();
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
        return await this.promptForRuntimeAsync();
      }
    }

    Log.log(this.formatCantFindRuntime());
    const selectedRuntime = await this.selectRuntimesAsync(graphqlClient, {
      appId: projectId,
      branchName: this.branchInfo.name,
      anotherBranchIdToIntersectRuntimesBy: this.options.anotherBranchToIntersectRuntimesBy?.id,
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
      first: 1,
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
      branchName,
      anotherBranchIdToIntersectRuntimesBy,
      batchSize = 5,
    }: {
      appId: string;
      branchName: string;
      anotherBranchIdToIntersectRuntimesBy?: string;
      batchSize?: number;
    }
  ): Promise<RuntimeFragment | null> {
    const queryAsync = async (queryParams: QueryParams): Promise<Connection<RuntimeFragment>> => {
      return await RuntimeQuery.getRuntimesOnBranchAsync(graphqlClient, {
        appId,
        name: branchName,
        first: queryParams.first,
        after: queryParams.after,
        last: queryParams.last,
        before: queryParams.before,
        filter: {
          branchId: anotherBranchIdToIntersectRuntimesBy,
        },
      });
    };
    const getTitleAsync = async (runtime: RuntimeFragment): Promise<string> => {
      return await this.displayLatestUpdateGroupAsync({
        graphqlClient,
        appId,
        branchName,
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

  async promptForRuntimeAsync(): Promise<string> {
    Log.log(`You can input a runtime manually then publish an update later.`);
    const { runtimeVersion } = await promptAsync({
      type: 'text',
      name: 'runtimeVersion',
      message: 'Input a runtime version:',
      initial: '1.0.0',
    });
    return runtimeVersion;
  }
}
