import { ExpoConfig } from '@expo/config';
import assert from 'assert';
import nullthrows from 'nullthrows';

import { getBranchFromChannelNameAndCreateAndLinkIfNotExistsAsync } from './getBranchFromChannelNameAndCreateAndLinkIfNotExistsAsync';
import {
  selectRuntimeAndGetLatestUpdateGroupForEachPublishPlatformOnBranchAsync,
  selectUpdateGroupOnBranchAsync,
} from './queries';
import { truncateString as truncateUpdateMessage } from './utils';
import { selectBranchOnAppAsync } from '../branch/queries';
import { getUpdateGroupUrl } from '../build/utils/url';
import { selectChannelOnAppAsync } from '../channel/queries';
import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import { getPaginatedQueryOptions } from '../commandUtils/pagination';
import fetch from '../fetch';
import { UpdateFragment, UpdateInfoGroup } from '../graphql/generated';
import { PublishMutation } from '../graphql/mutations/PublishMutation';
import { UpdateQuery } from '../graphql/queries/UpdateQuery';
import Log, { link } from '../log';
import { ora } from '../ora';
import { getOwnerAccountForProjectIdAsync } from '../project/projectUtils';
import { UpdatePublishPlatform, getUpdateRolloutInfoGroupAsync } from '../project/publish';
import { promptAsync } from '../prompts';
import {
  CodeSigningInfo,
  checkDirectiveBodyAgainstUpdateInfoGroup,
  checkManifestBodyAgainstUpdateInfoGroup,
  getDirectiveBodyAsync,
  getManifestBodyAsync,
  signBody,
} from '../utils/code-signing';
import formatFields from '../utils/formatFields';
import { printJsonOnlyOutput } from '../utils/json';

export type UpdateToRepublish = {
  groupId: string;
  branchId: string;
  branchName: string;
} & UpdateFragment;

/**
 * @param updatesToPublish The update group to republish
 * @param targetBranch The branch to repubish the update group on
 */
export async function republishAsync({
  graphqlClient,
  app,
  updatesToPublish,
  targetBranch,
  updateMessage,
  codeSigningInfo,
  json,
  rolloutPercentage,
}: {
  graphqlClient: ExpoGraphqlClient;
  app: { exp: ExpoConfig; projectId: string };
  updatesToPublish: UpdateToRepublish[];
  targetBranch: { branchName: string; branchId: string };
  updateMessage: string;
  codeSigningInfo?: CodeSigningInfo;
  json?: boolean;
  rolloutPercentage?: number;
}): Promise<void> {
  const { branchName: targetBranchName, branchId: targetBranchId } = targetBranch;

  // The update group properties are the same for all updates
  assert(updatesToPublish.length > 0, 'Updates to republish must be provided');
  const arbitraryUpdate = updatesToPublish[0];
  const isSameGroup = (update: UpdateToRepublish): boolean =>
    update.groupId === arbitraryUpdate.groupId &&
    update.branchId === arbitraryUpdate.branchId &&
    update.branchName === arbitraryUpdate.branchName &&
    update.runtimeVersion === arbitraryUpdate.runtimeVersion &&
    update.manifestHostOverride === arbitraryUpdate.manifestHostOverride &&
    update.assetHostOverride === arbitraryUpdate.assetHostOverride;
  assert(
    updatesToPublish.every(isSameGroup),
    'All updates being republished must belong to the same update group'
  );

  assert(
    updatesToPublish.every(u => u.isRollBackToEmbedded) ||
      updatesToPublish.every(u => !u.isRollBackToEmbedded),
    'All updates must either be roll back to embedded updates or not'
  );

  assert(
    !updatesToPublish.some(u => !!u.rolloutControlUpdate),
    'Cannot republish an update that is being rolled-out. Either complete the update rollout and then republish or publish a new rollout update.'
  );

  const { runtimeVersion } = arbitraryUpdate;

  // If codesigning was created for the original update, we need to add it to the republish.
  // If one wishes to not sign the republish or sign with a different key, a normal publish should
  // be performed.
  const shouldRepublishWithCodesigning = updatesToPublish.some(update => update.codeSigningInfo);
  if (shouldRepublishWithCodesigning) {
    if (!codeSigningInfo) {
      throw new Error(
        'Must specify --private-key-path argument to sign republished update group for code signing'
      );
    }

    for (const update of updatesToPublish) {
      if (
        nullthrows(update.codeSigningInfo).alg !== codeSigningInfo.codeSigningMetadata.alg ||
        nullthrows(update.codeSigningInfo).keyid !== codeSigningInfo.codeSigningMetadata.keyid
      ) {
        throw new Error(
          'Republished updates must use the same code signing key and algorithm as original update'
        );
      }
    }

    Log.withTick(
      `The republished update group will be signed with the same code signing key and algorithm as the original update`
    );
  }

  const publishIndicator = ora('Republishing...').start();
  let updatesRepublished: Awaited<ReturnType<typeof PublishMutation.publishUpdateGroupAsync>>;

  try {
    const arbitraryUpdate = updatesToPublish[0];
    const objectToMergeIn = arbitraryUpdate.isRollBackToEmbedded
      ? {
          rollBackToEmbeddedInfoGroup: Object.fromEntries(
            updatesToPublish.map(update => [update.platform, true])
          ),
        }
      : {
          updateInfoGroup: Object.fromEntries(
            updatesToPublish.map(update => [update.platform, JSON.parse(update.manifestFragment)])
          ),
          fingerprintInfoGroup: Object.fromEntries(
            updatesToPublish.map(update => {
              const fingerprint = update.fingerprint;
              if (!fingerprint) {
                return [update.platform, undefined];
              }
              return [
                update.platform,
                {
                  fingerprintHash: fingerprint.hash,
                  fingerprintSource: fingerprint.source
                    ? {
                        type: fingerprint.source.type,
                        bucketKey: fingerprint.source.bucketKey,
                        isDebugFingerprint: fingerprint.source.isDebugFingerprint,
                      }
                    : undefined,
                },
              ];
            })
          ),
          rolloutInfoGroup: rolloutPercentage
            ? await getUpdateRolloutInfoGroupAsync(graphqlClient, {
                appId: app.projectId,
                branchName: targetBranchName,
                runtimeVersion,
                rolloutPercentage,
                platforms: updatesToPublish.map(update => update.platform as UpdatePublishPlatform),
              })
            : null,
        };

    updatesRepublished = await PublishMutation.publishUpdateGroupAsync(graphqlClient, [
      {
        branchId: targetBranchId,
        runtimeVersion,
        message: updateMessage,
        ...objectToMergeIn,
        gitCommitHash: updatesToPublish[0].gitCommitHash,
        isGitWorkingTreeDirty: updatesToPublish[0].isGitWorkingTreeDirty,
        environment: updatesToPublish[0].environment,
        awaitingCodeSigningInfo: !!codeSigningInfo,
        manifestHostOverride: updatesToPublish[0].manifestHostOverride,
        assetHostOverride: updatesToPublish[0].assetHostOverride,
      },
    ]);

    if (codeSigningInfo) {
      Log.log('🔒 Signing republished update group');

      await Promise.all(
        updatesRepublished.map(async newUpdate => {
          const response = await fetch(newUpdate.manifestPermalink, {
            method: 'GET',
            headers: { accept: 'multipart/mixed' },
          });

          let signature;
          if (newUpdate.isRollBackToEmbedded) {
            const directiveBody = nullthrows(await getDirectiveBodyAsync(response));

            checkDirectiveBodyAgainstUpdateInfoGroup(directiveBody);
            signature = signBody(directiveBody, codeSigningInfo);
          } else {
            const manifestBody = nullthrows(await getManifestBodyAsync(response));

            checkManifestBodyAgainstUpdateInfoGroup(
              manifestBody,
              nullthrows(
                nullthrows(objectToMergeIn.updateInfoGroup)[
                  newUpdate.platform as keyof UpdateInfoGroup
                ]
              )
            );
            signature = signBody(manifestBody, codeSigningInfo);
          }

          await PublishMutation.setCodeSigningInfoAsync(graphqlClient, newUpdate.id, {
            alg: codeSigningInfo.codeSigningMetadata.alg,
            keyid: codeSigningInfo.codeSigningMetadata.keyid,
            sig: signature,
          });
        })
      );
    }

    publishIndicator.succeed('Republished update group');
  } catch (error: any) {
    publishIndicator.fail('Failed to republish update group');
    throw error;
  }

  if (json) {
    printJsonOnlyOutput(updatesRepublished);
    return;
  }

  const updatesRepublishedByPlatform = Object.fromEntries(
    updatesRepublished.map(update => [update.platform, update])
  );

  const arbitraryRepublishedUpdate = updatesRepublished[0];
  const updateGroupUrl = getUpdateGroupUrl(
    (await getOwnerAccountForProjectIdAsync(graphqlClient, app.projectId)).name,
    app.exp.slug,
    arbitraryRepublishedUpdate.group
  );

  Log.addNewLineIfNone();
  Log.log(
    formatFields([
      { label: 'Branch', value: targetBranchName },
      { label: 'Runtime version', value: arbitraryRepublishedUpdate.runtimeVersion },
      { label: 'Platform', value: updatesRepublished.map(update => update.platform).join(', ') },
      { label: 'Update group ID', value: arbitraryRepublishedUpdate.group },
      ...(updatesRepublishedByPlatform.android
        ? [{ label: 'Android update ID', value: updatesRepublishedByPlatform.android.id }]
        : []),
      ...(updatesRepublishedByPlatform.ios
        ? [{ label: 'iOS update ID', value: updatesRepublishedByPlatform.ios.id }]
        : []),
      ...(updatesRepublishedByPlatform.android?.rolloutControlUpdate
        ? [
            {
              label: 'Android Rollout',
              value: `${updatesRepublishedByPlatform.android?.rolloutPercentage}% (Base update ID: ${updatesRepublishedByPlatform.android?.rolloutControlUpdate.id})`,
            },
          ]
        : []),
      ...(updatesRepublishedByPlatform.ios?.rolloutControlUpdate
        ? [
            {
              label: 'iOS Rollout',
              value: `${updatesRepublishedByPlatform.ios?.rolloutPercentage}% (Base update ID: ${updatesRepublishedByPlatform.ios?.rolloutControlUpdate.id})`,
            },
          ]
        : []),
      { label: 'Message', value: updateMessage },
      { label: 'EAS Dashboard', value: link(updateGroupUrl, { dim: false }) },
    ])
  );
}

type GetUpdateOrAskForUpdatesOptions = {
  nonInteractive: boolean;
  json: boolean;
  groupId?: string;
  branchName?: string;
  channelName?: string;
};

export async function getUpdateGroupAsync(
  graphqlClient: ExpoGraphqlClient,
  groupId: string
): Promise<UpdateToRepublish[]> {
  const updateGroup = await UpdateQuery.viewUpdateGroupAsync(graphqlClient, {
    groupId,
  });

  return updateGroup.map(update => ({
    ...update,
    groupId: update.group,
    branchId: update.branch.id,
    branchName: update.branch.name,
  }));
}

type AskUpdateGroupForEachPublishPlatformFilteringByRuntimeVersionOptions = {
  nonInteractive: boolean;
  json: boolean;
  branchName?: string;
  channelName?: string;
};

export async function askUpdateGroupForEachPublishPlatformFilteringByRuntimeVersionAsync(
  graphqlClient: ExpoGraphqlClient,
  projectId: string,
  options: AskUpdateGroupForEachPublishPlatformFilteringByRuntimeVersionOptions
): Promise<Record<UpdatePublishPlatform, UpdateToRepublish[] | undefined>> {
  if (options.nonInteractive) {
    throw new Error('Must supply --group when in non-interactive mode');
  }

  if (options.branchName) {
    return await askUpdateGroupForEachPublishPlatformFromBranchNameFilteringByRuntimeVersionAsync(
      graphqlClient,
      {
        ...options,
        branchName: options.branchName,
        projectId,
      }
    );
  }

  if (options.channelName) {
    return await askUpdateGroupForEachPublishPlatformFromChannelNameFilteringByRuntimeVersionAsync(
      graphqlClient,
      {
        ...options,
        channelName: options.channelName,
        projectId,
      }
    );
  }

  const { choice } = await promptAsync({
    type: 'select',
    message: 'Find update by branch or channel?',
    name: 'choice',
    choices: [
      { title: 'Branch', value: 'branch' },
      { title: 'Channel', value: 'channel' },
    ],
  });

  if (choice === 'channel') {
    const { name } = await selectChannelOnAppAsync(graphqlClient, {
      projectId,
      selectionPromptTitle: 'Select a channel to view',
      paginatedQueryOptions: {
        json: options.json,
        nonInteractive: options.nonInteractive,
        offset: 0,
      },
    });

    return await askUpdateGroupForEachPublishPlatformFromChannelNameFilteringByRuntimeVersionAsync(
      graphqlClient,
      {
        ...options,
        channelName: name,
        projectId,
      }
    );
  } else if (choice === 'branch') {
    const { name } = await selectBranchOnAppAsync(graphqlClient, {
      projectId,
      promptTitle: 'Select branch from which to choose update',
      displayTextForListItem: updateBranch => ({
        title: updateBranch.name,
      }),
      // discard limit and offset because this query is not their intended target
      paginatedQueryOptions: {
        json: options.json,
        nonInteractive: options.nonInteractive,
        offset: 0,
      },
    });

    return await askUpdateGroupForEachPublishPlatformFromBranchNameFilteringByRuntimeVersionAsync(
      graphqlClient,
      {
        ...options,
        branchName: name,
        projectId,
      }
    );
  } else {
    throw new Error('Must choose update via channel or branch');
  }
}

export async function getUpdateGroupOrAskForUpdateGroupAsync(
  graphqlClient: ExpoGraphqlClient,
  projectId: string,
  options: GetUpdateOrAskForUpdatesOptions
): Promise<UpdateToRepublish[]> {
  if (options.groupId) {
    return await getUpdateGroupAsync(graphqlClient, options.groupId);
  }

  if (options.nonInteractive) {
    throw new Error('Must supply --group when in non-interactive mode');
  }

  if (options.branchName) {
    return await askUpdatesFromBranchNameAsync(graphqlClient, {
      ...options,
      branchName: options.branchName,
      projectId,
    });
  }

  if (options.channelName) {
    return await askUpdatesFromChannelNameAsync(graphqlClient, {
      ...options,
      channelName: options.channelName,
      projectId,
    });
  }

  const { choice } = await promptAsync({
    type: 'select',
    message: 'Find update by branch or channel?',
    name: 'choice',
    choices: [
      { title: 'Branch', value: 'branch' },
      { title: 'Channel', value: 'channel' },
    ],
  });

  if (choice === 'channel') {
    const { name } = await selectChannelOnAppAsync(graphqlClient, {
      projectId,
      selectionPromptTitle: 'Select a channel to view',
      paginatedQueryOptions: {
        json: options.json,
        nonInteractive: options.nonInteractive,
        offset: 0,
      },
    });

    return await askUpdatesFromChannelNameAsync(graphqlClient, {
      ...options,
      channelName: name,
      projectId,
    });
  } else if (choice === 'branch') {
    const { name } = await selectBranchOnAppAsync(graphqlClient, {
      projectId,
      promptTitle: 'Select branch from which to choose update',
      displayTextForListItem: updateBranch => ({
        title: updateBranch.name,
      }),
      // discard limit and offset because this query is not their intended target
      paginatedQueryOptions: {
        json: options.json,
        nonInteractive: options.nonInteractive,
        offset: 0,
      },
    });

    return await askUpdatesFromBranchNameAsync(graphqlClient, {
      ...options,
      branchName: name,
      projectId,
    });
  } else {
    throw new Error('Must choose update via channel or branch');
  }
}

async function askUpdateGroupForEachPublishPlatformFromBranchNameFilteringByRuntimeVersionAsync(
  graphqlClient: ExpoGraphqlClient,
  {
    projectId,
    branchName,
    json,
    nonInteractive,
  }: { projectId: string; branchName: string; json: boolean; nonInteractive: boolean }
): Promise<Record<UpdatePublishPlatform, UpdateToRepublish[] | undefined>> {
  const publishPlatformToLatestUpdateGroup =
    await selectRuntimeAndGetLatestUpdateGroupForEachPublishPlatformOnBranchAsync(graphqlClient, {
      projectId,
      branchName,
      paginatedQueryOptions: getPaginatedQueryOptions({ json, 'non-interactive': nonInteractive }),
    });

  return {
    ios: publishPlatformToLatestUpdateGroup.ios?.map(update => ({
      ...update,
      groupId: update.group,
      branchId: update.branch.id,
      branchName: update.branch.name,
    })),
    android: publishPlatformToLatestUpdateGroup.android?.map(update => ({
      ...update,
      groupId: update.group,
      branchId: update.branch.id,
      branchName: update.branch.name,
    })),
  };
}

async function askUpdatesFromBranchNameAsync(
  graphqlClient: ExpoGraphqlClient,
  {
    projectId,
    branchName,
    json,
    nonInteractive,
  }: { projectId: string; branchName: string; json: boolean; nonInteractive: boolean }
): Promise<UpdateToRepublish[]> {
  const updateGroup = await selectUpdateGroupOnBranchAsync(graphqlClient, {
    projectId,
    branchName,
    paginatedQueryOptions: getPaginatedQueryOptions({ json, 'non-interactive': nonInteractive }),
  });

  return updateGroup.map(update => ({
    ...update,
    groupId: update.group,
    branchId: update.branch.id,
    branchName: update.branch.name,
  }));
}

async function askUpdateGroupForEachPublishPlatformFromChannelNameFilteringByRuntimeVersionAsync(
  graphqlClient: ExpoGraphqlClient,
  {
    projectId,
    channelName,
    json,
    nonInteractive,
  }: { projectId: string; channelName: string; json: boolean; nonInteractive: boolean }
): Promise<Record<UpdatePublishPlatform, UpdateToRepublish[] | undefined>> {
  const { branchName } = await getBranchFromChannelNameAndCreateAndLinkIfNotExistsAsync(
    graphqlClient,
    projectId,
    channelName
  );

  return await askUpdateGroupForEachPublishPlatformFromBranchNameFilteringByRuntimeVersionAsync(
    graphqlClient,
    {
      projectId,
      branchName,
      json,
      nonInteractive,
    }
  );
}

async function askUpdatesFromChannelNameAsync(
  graphqlClient: ExpoGraphqlClient,
  {
    projectId,
    channelName,
    json,
    nonInteractive,
  }: { projectId: string; channelName: string; json: boolean; nonInteractive: boolean }
): Promise<UpdateToRepublish[]> {
  const { branchName } = await getBranchFromChannelNameAndCreateAndLinkIfNotExistsAsync(
    graphqlClient,
    projectId,
    channelName
  );

  return await askUpdatesFromBranchNameAsync(graphqlClient, {
    projectId,
    branchName,
    json,
    nonInteractive,
  });
}

type GetOrAskUpdateMessageOptions = {
  updateMessage?: string;
  nonInteractive: boolean;
  json: boolean;
};

/**
 * Get or ask the user for the update (group) message for the republish
 */
export async function getOrAskUpdateMessageAsync(
  updateGroup: UpdateToRepublish[],
  options: GetOrAskUpdateMessageOptions
): Promise<string> {
  if (options.updateMessage) {
    return sanitizeUpdateMessage(options.updateMessage);
  }

  if (options.nonInteractive || options.json) {
    throw new Error('Must supply --message when in non-interactive mode');
  }

  // This command only uses a single update group to republish, meaning these values are always identical
  const oldGroupId = updateGroup[0].groupId;
  const oldUpdateMessage = updateGroup[0].message;

  const { updateMessage } = await promptAsync({
    type: 'text',
    name: 'updateMessage',
    message: 'Provide an update message.',
    initial: `Republish "${oldUpdateMessage!}" - group: ${oldGroupId}`,
    validate: (value: any) => (value ? true : 'Update message may not be empty.'),
  });

  return sanitizeUpdateMessage(updateMessage);
}

function sanitizeUpdateMessage(updateMessage: string): string {
  if (updateMessage !== truncateUpdateMessage(updateMessage, 1024)) {
    Log.warn('Update message exceeds the allowed 1024 character limit, truncated update message.');
    return truncateUpdateMessage(updateMessage, 1024);
  }

  return updateMessage;
}
