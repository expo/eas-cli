import { ExpoConfig } from '@expo/config';
import nullthrows from 'nullthrows';

import { getUpdateJsonInfosForUpdates } from './utils';
import { getUpdateGroupUrl } from '../build/utils/url';
import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import fetch from '../fetch';
import { PublishUpdateGroupInput, UpdatePublishMutation } from '../graphql/generated';
import { PublishMutation } from '../graphql/mutations/PublishMutation';
import Log, { link } from '../log';
import { ora } from '../ora';
import { getOwnerAccountForProjectIdAsync } from '../project/projectUtils';
import {
  RuntimeVersionInfo,
  UpdatePublishPlatform,
  getRuntimeToPlatformsAndFingerprintInfoMappingFromRuntimeVersionInfoObjects,
} from '../project/publish';
import {
  CodeSigningInfo,
  checkDirectiveBodyAgainstUpdateInfoGroup,
  getDirectiveBodyAsync,
  signBody,
} from '../utils/code-signing';
import uniqBy from '../utils/expodash/uniqBy';
import formatFields from '../utils/formatFields';
import { printJsonOnlyOutput } from '../utils/json';

export async function publishRollBackToEmbeddedUpdateAsync({
  graphqlClient,
  projectId,
  exp,
  updateMessage,
  branch,
  codeSigningInfo,
  platforms,
  runtimeVersion,
  json,
}: {
  graphqlClient: ExpoGraphqlClient;
  projectId: string;
  exp: ExpoConfig;
  updateMessage: string | undefined;
  branch: { name: string; id: string };
  codeSigningInfo: CodeSigningInfo | undefined;
  platforms: UpdatePublishPlatform[];
  runtimeVersion: string;
  json: boolean;
}): Promise<void> {
  const runtimeToPlatformsAndFingerprintInfoMapping =
    getRuntimeToPlatformsAndFingerprintInfoMappingFromRuntimeVersionInfoObjects(
      platforms.map(platform => ({
        platform,
        runtimeVersionInfo: {
          runtimeVersion,
          expoUpdatesRuntimeFingerprint: null,
          expoUpdatesRuntimeFingerprintHash: null,
        },
      }))
    );

  let newUpdates: UpdatePublishMutation['updateBranch']['publishUpdateGroups'];
  const publishSpinner = ora('Publishing...').start();
  try {
    newUpdates = await publishRollbacksAsync({
      graphqlClient,
      updateMessage,
      branchId: branch.id,
      codeSigningInfo,
      runtimeToPlatformsAndFingerprintInfoMapping,
      platforms,
    });
    publishSpinner.succeed('Published!');
  } catch (e) {
    publishSpinner.fail('Failed to publish updates');
    throw e;
  }

  if (json) {
    printJsonOnlyOutput(getUpdateJsonInfosForUpdates(newUpdates));
  } else {
    Log.addNewLineIfNone();

    for (const runtime of uniqBy(
      runtimeToPlatformsAndFingerprintInfoMapping,
      version => version.runtimeVersion
    )) {
      const newUpdatesForRuntimeVersion = newUpdates.filter(
        update => update.runtimeVersion === runtime.runtimeVersion
      );
      if (newUpdatesForRuntimeVersion.length === 0) {
        throw new Error(
          `Publish response is missing updates with runtime ${runtime.runtimeVersion}.`
        );
      }
      const platforms = newUpdatesForRuntimeVersion.map(update => update.platform);
      const newAndroidUpdate = newUpdatesForRuntimeVersion.find(
        update => update.platform === 'android'
      );
      const newIosUpdate = newUpdatesForRuntimeVersion.find(update => update.platform === 'ios');
      const updateGroupId = newUpdatesForRuntimeVersion[0].group;

      const projectName = exp.slug;
      const accountName = (await getOwnerAccountForProjectIdAsync(graphqlClient, projectId)).name;
      const updateGroupUrl = getUpdateGroupUrl(accountName, projectName, updateGroupId);
      const updateGroupLink = link(updateGroupUrl, { dim: false });

      Log.log(
        formatFields([
          { label: 'Branch', value: branch.name },
          { label: 'Runtime version', value: runtime.runtimeVersion },
          { label: 'Platform', value: platforms.join(', ') },
          { label: 'Update group ID', value: updateGroupId },
          ...(newAndroidUpdate ? [{ label: 'Android update ID', value: newAndroidUpdate.id }] : []),
          ...(newIosUpdate ? [{ label: 'iOS update ID', value: newIosUpdate.id }] : []),
          { label: 'Message', value: updateMessage ?? '' },
          { label: 'EAS Dashboard', value: updateGroupLink },
        ])
      );
      Log.addNewLineIfNone();
    }
  }
}

async function publishRollbacksAsync({
  graphqlClient,
  updateMessage,
  branchId,
  codeSigningInfo,
  runtimeToPlatformsAndFingerprintInfoMapping,
  platforms,
}: {
  graphqlClient: ExpoGraphqlClient;
  updateMessage: string | undefined;
  branchId: string;
  codeSigningInfo: CodeSigningInfo | undefined;
  runtimeToPlatformsAndFingerprintInfoMapping: (RuntimeVersionInfo & {
    platforms: UpdatePublishPlatform[];
  })[];
  platforms: UpdatePublishPlatform[];
}): Promise<UpdatePublishMutation['updateBranch']['publishUpdateGroups']> {
  const rollbackInfoGroups = Object.fromEntries(platforms.map(platform => [platform, true]));

  // Sort the updates into different groups based on their platform specific runtime versions
  const updateGroups: PublishUpdateGroupInput[] = runtimeToPlatformsAndFingerprintInfoMapping.map(
    ({ runtimeVersion, platforms }) => {
      const localRollbackInfoGroup = Object.fromEntries(
        platforms.map(platform => [platform, rollbackInfoGroups[platform]])
      );

      return {
        branchId,
        rollBackToEmbeddedInfoGroup: localRollbackInfoGroup,
        runtimeVersion,
        message: updateMessage,
        awaitingCodeSigningInfo: !!codeSigningInfo,
      };
    }
  );

  const newUpdates = await PublishMutation.publishUpdateGroupAsync(graphqlClient, updateGroups);

  if (codeSigningInfo) {
    Log.log('🔒 Signing roll back');

    const updatesTemp = [...newUpdates];
    const updateGroupsAndTheirUpdates = updateGroups.map(updateGroup => {
      const newUpdates = updatesTemp.splice(
        0,
        Object.keys(nullthrows(updateGroup.rollBackToEmbeddedInfoGroup)).length
      );
      return {
        updateGroup,
        newUpdates,
      };
    });

    await Promise.all(
      updateGroupsAndTheirUpdates.map(async ({ newUpdates }) => {
        await Promise.all(
          newUpdates.map(async newUpdate => {
            const response = await fetch(newUpdate.manifestPermalink, {
              method: 'GET',
              headers: { accept: 'multipart/mixed' },
            });
            const directiveBody = nullthrows(await getDirectiveBodyAsync(response));

            checkDirectiveBodyAgainstUpdateInfoGroup(directiveBody);

            const directiveSignature = signBody(directiveBody, codeSigningInfo);

            await PublishMutation.setCodeSigningInfoAsync(graphqlClient, newUpdate.id, {
              alg: codeSigningInfo.codeSigningMetadata.alg,
              keyid: codeSigningInfo.codeSigningMetadata.keyid,
              sig: directiveSignature,
            });
          })
        );
      })
    );
  }

  return newUpdates;
}
