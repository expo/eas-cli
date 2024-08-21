import { ExpoConfig } from '@expo/config';
import assert from 'assert';
import nullthrows from 'nullthrows';

import { getUpdateGroupUrl } from '../build/utils/url';
import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import fetch from '../fetch';
import { UpdateFragment, UpdateInfoGroup } from '../graphql/generated';
import { PublishMutation } from '../graphql/mutations/PublishMutation';
import Log, { link } from '../log';
import { ora } from '../ora';
import { getOwnerAccountForProjectIdAsync } from '../project/projectUtils';
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
}: {
  graphqlClient: ExpoGraphqlClient;
  app: { exp: ExpoConfig; projectId: string };
  updatesToPublish: UpdateToRepublish[];
  targetBranch: { branchName: string; branchId: string };
  updateMessage: string;
  codeSigningInfo?: CodeSigningInfo;
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

  assert(
    updatesToPublish.every(u => u.isRollBackToEmbedded) ||
      updatesToPublish.every(u => !u.isRollBackToEmbedded),
    'All updates must either be roll back to embedded updates or not'
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

    Log.withTick(`The republished update group will be signed`);
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
        };

    updatesRepublished = await PublishMutation.publishUpdateGroupAsync(graphqlClient, [
      {
        branchId: targetBranchId,
        runtimeVersion,
        message: updateMessage,
        ...objectToMergeIn,
        gitCommitHash: updatesToPublish[0].gitCommitHash,
        awaitingCodeSigningInfo: !!codeSigningInfo,
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
      { label: 'Message', value: updateMessage },
      { label: 'EAS Dashboard', value: link(updateGroupUrl, { dim: false }) },
    ])
  );
}
