import { ExpoConfig } from '@expo/config';
import assert from 'assert';

import { getUpdateGroupUrl } from '../build/utils/url';
import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import { Update } from '../graphql/generated';
import { PublishMutation } from '../graphql/mutations/PublishMutation';
import Log, { link } from '../log';
import { ora } from '../ora';
import { getOwnerAccountForProjectIdAsync } from '../project/projectUtils';
import formatFields from '../utils/formatFields';
import { printJsonOnlyOutput } from '../utils/json';

export type UpdateToRepublish = {
  groupId: string;
  branchId: string;
  branchName: string;
} & Pick<
  Update,
  | 'message'
  | 'runtimeVersion'
  | 'manifestFragment'
  | 'platform'
  | 'gitCommitHash'
  | 'codeSigningInfo'
>;

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
  json,
}: {
  graphqlClient: ExpoGraphqlClient;
  app: { exp: ExpoConfig; projectId: string };
  updatesToPublish: UpdateToRepublish[];
  targetBranch: { branchName: string; branchId: string };
  updateMessage: string;
  json?: boolean;
}): Promise<void> {
  const { branchName: targetBranchName, branchId: targetBranchId } = targetBranch;

  // The update group properties are the same for all updates
  assert(updatesToPublish.length > 0, 'Updates to republish must be provided');
  const arbitraryUpdate = updatesToPublish[0];
  const isSameGroup = (update: UpdateToRepublish): boolean =>
    update.groupId === arbitraryUpdate.groupId &&
    update.branchId === arbitraryUpdate.branchId &&
    update.branchName === arbitraryUpdate.branchName &&
    update.runtimeVersion === arbitraryUpdate.runtimeVersion;
  assert(updatesToPublish.every(isSameGroup), 'All updates must belong to the same update group');
  const { runtimeVersion } = arbitraryUpdate;

  // If codesigning was created for the original update, we need to add it to the republish
  const shouldRepublishWithCodesigning = updatesToPublish.some(update => update.codeSigningInfo);
  if (shouldRepublishWithCodesigning) {
    Log.withTick(
      `The republished update will be signed with the same codesigning as the original update.`
    );
  }

  const publishIndicator = ora('Republishing...').start();
  let updatesRepublished: Awaited<ReturnType<typeof PublishMutation.publishUpdateGroupAsync>>;

  try {
    updatesRepublished = await PublishMutation.publishUpdateGroupAsync(graphqlClient, [
      {
        branchId: targetBranchId,
        runtimeVersion,
        message: updateMessage,
        updateInfoGroup: Object.fromEntries(
          updatesToPublish.map(update => [update.platform, JSON.parse(update.manifestFragment)])
        ),
        gitCommitHash: updatesToPublish[0].gitCommitHash,
        awaitingCodeSigningInfo: shouldRepublishWithCodesigning,
      },
    ]);

    if (shouldRepublishWithCodesigning) {
      const codeSigningByPlatform = Object.fromEntries(
        updatesToPublish.map(update => [update.platform, update.codeSigningInfo])
      );

      await Promise.all(
        updatesRepublished.map(async update => {
          const codeSigning = codeSigningByPlatform[update.platform];
          if (codeSigning) {
            await PublishMutation.setCodeSigningInfoAsync(graphqlClient, update.id, codeSigning);
          }
        })
      );
    }

    publishIndicator.succeed('Republished update');
  } catch (error: any) {
    publishIndicator.fail('Failed to republish update');
    throw error;
  }

  if (json) {
    return printJsonOnlyOutput(updatesRepublished);
  }

  const updatesRepublishedByPlatform = Object.fromEntries(
    updatesRepublished.map(update => [update.platform, update])
  );

  const updateGroupUrl = getUpdateGroupUrl(
    (await getOwnerAccountForProjectIdAsync(graphqlClient, app.projectId)).name,
    app.exp.slug,
    updatesRepublished[0].group
  );

  Log.addNewLineIfNone();
  Log.log(
    formatFields([
      { label: 'Branch', value: targetBranchName },
      { label: 'Runtime version', value: updatesRepublished[0].runtimeVersion },
      { label: 'Platform', value: updatesRepublished.map(update => update.platform).join(', ') },
      { label: 'Update Group ID', value: updatesRepublished[0].id },
      ...(updatesRepublishedByPlatform.android
        ? [{ label: 'Android update ID', value: updatesRepublishedByPlatform.android.id }]
        : []),
      ...(updatesRepublishedByPlatform.ios
        ? [{ label: 'iOS update ID', value: updatesRepublishedByPlatform.ios.id }]
        : []),
      { label: 'Message', value: updateMessage },
      { label: 'Website link', value: link(updateGroupUrl, { dim: false }) },
    ])
  );
}
