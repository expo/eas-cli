import { UserError } from '@expo/eas-build-job';
import { bunyan } from '@expo/logger';
import { BuildFunction, BuildStepInput, BuildStepInputValueTypeName } from '@expo/steps';
import path from 'node:path';
import limitFactory from 'promise-limit';
import { z } from 'zod';

import { AscApiClient, AscApiRequestError } from '../utils/ios/AscApiClient';
import { AscApiUtils } from '../utils/ios/AscApiUtils';

export function createUpdateTestFlightMetadataBuildFunction(): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'update_testflight_metadata',
    name: 'Update TestFlight metadata',
    __metricsId: 'eas/update_testflight_metadata',
    inputProviders: [
      BuildStepInput.createProvider({
        id: 'asc_api_key_path',
        required: true,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
      BuildStepInput.createProvider({
        id: 'build_upload_id',
        required: true,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
      BuildStepInput.createProvider({
        id: 'changelog',
        required: false,
        defaultValue: '',
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
      BuildStepInput.createProvider({
        id: 'groups',
        required: false,
        defaultValue: [],
        allowedValueTypeName: BuildStepInputValueTypeName.JSON,
      }),
    ],
    fn: async (ctx, { inputs }) => {
      const parsedInputs = z
        .object({
          asc_api_key_path: z.string(),
          build_upload_id: z.string(),
          changelog: z.string(),
          groups: z.array(z.string()),
        })
        .parse({
          asc_api_key_path: inputs.asc_api_key_path.value,
          build_upload_id: inputs.build_upload_id.value,
          changelog: inputs.changelog.value,
          groups: inputs.groups.value,
        });
      const keyPath = path.resolve(ctx.workingDirectory, parsedInputs.asc_api_key_path);
      await updateTestFlightMetadataAsync({
        client: new AscApiClient({
          key: await AscApiUtils.loadApiKeyAsync({ keyPath }),
          logger: ctx.logger,
        }),
        buildUploadId: parsedInputs.build_upload_id,
        changelog: parsedInputs.changelog,
        groups: parsedInputs.groups,
        logger: ctx.logger,
      });
      ctx.logger.info('TestFlight metadata updated.');
    },
  });
}

export async function updateTestFlightMetadataAsync({
  client,
  buildUploadId,
  changelog,
  groups,
  logger,
}: {
  client: AscApiClient;
  buildUploadId: string;
  changelog: string;
  groups: string[];
  logger: bunyan;
}): Promise<void> {
  const { data: upload } = await client.getAsync(
    '/v1/buildUploads/:id',
    {
      'fields[buildUploads]': ['state', 'build'],
      include: ['build'],
    },
    { id: buildUploadId }
  );
  const buildId = upload.relationships?.build?.data?.id;
  if (upload.attributes?.state?.state !== 'COMPLETE' || !buildId) {
    throw new UserError(
      'EAS_TESTFLIGHT_BUILD_NOT_READY',
      'The uploaded build is not ready for TestFlight metadata. Run eas/upload_to_asc with wait_for_processing: true first.'
    );
  }
  logger.info(`Updating TestFlight metadata for Apple build ${buildId}...`);
  const { data: app } = await client.getAsync('/v1/builds/:id/app', {}, { id: buildId });
  const limit = limitFactory<void>(1);
  const results = await Promise.allSettled([
    limit(async () => {
      if (!changelog) {
        return;
      }
      logger.info(`Updating changelog: ${JSON.stringify(changelog)}`);
      const primaryLocale = app.attributes?.primaryLocale || 'en-US';
      if (!app.attributes?.primaryLocale) {
        logger.warn('App Store Connect did not return the primary locale; using "en-US".');
      }
      logger.info(`Primary locale: ${JSON.stringify(primaryLocale)}.`);
      const localizations = await AscApiUtils.getAllBetaBuildLocalizationsAsync({
        client,
        buildId,
      });
      const localizationLimit = limitFactory<void>(1);
      const updates = localizations.map(localization =>
        localizationLimit(async () => {
          const label = `${JSON.stringify(localization.attributes?.locale ?? 'unknown')} (${localization.id})`;
          try {
            await client.patchAsync(
              '/v1/betaBuildLocalizations/:id',
              {
                data: {
                  type: 'betaBuildLocalizations',
                  id: localization.id,
                  attributes: { whatsNew: changelog },
                },
              },
              { id: localization.id }
            );
          } catch (error) {
            logger.error(`❌ Locale ${label}: changelog update failed. ${String(error)}`);
            throw error;
          }
          logger.info(`✅ Locale ${label}: changelog updated.`);
        })
      );
      if (!localizations.some(localization => localization.attributes?.locale === primaryLocale)) {
        updates.push(
          localizationLimit(async () => {
            try {
              await client.postAsync('/v1/betaBuildLocalizations', {
                data: {
                  type: 'betaBuildLocalizations',
                  attributes: { locale: primaryLocale, whatsNew: changelog },
                  relationships: { build: { data: { type: 'builds', id: buildId } } },
                },
              });
            } catch (error) {
              logger.error(
                `❌ Locale ${JSON.stringify(primaryLocale)}: localization creation failed. ${String(error)}`
              );
              throw error;
            }
            logger.info(`✅ Locale ${JSON.stringify(primaryLocale)}: localization created.`);
          })
        );
      }
      const localizationResults = await Promise.allSettled(updates);
      const localizationFailures = localizationResults.filter(
        result => result.status === 'rejected'
      );
      if (localizationFailures.length === 1) {
        throw localizationFailures[0].reason;
      }
      if (localizationFailures.length > 1) {
        throw new AggregateError(
          localizationFailures.map(failure => failure.reason),
          `Failed to update TestFlight localizations: ${localizationFailures.map(failure => String(failure.reason)).join('; ')}`
        );
      }
    }),
    limit(async () => {
      if (!groups.length) {
        return;
      }
      logger.info(`Apple app: ${app.id}. Requested groups: ${JSON.stringify(groups)}.`);
      const requestedNames = new Set(groups);
      const allGroups = await AscApiUtils.getAllBetaGroupsAsync({ client, appId: app.id });
      const requestedGroups = allGroups.filter(group =>
        requestedNames.has(group.attributes?.name ?? '')
      );
      const foundNames = new Set(requestedGroups.map(group => group.attributes?.name));
      const missingNames = [...requestedNames].filter(name => !foundNames.has(name));
      logger.info(`Found ${requestedGroups.length} TestFlight group(s).`);
      const assignedGroups = requestedGroups.length
        ? await AscApiUtils.getAllBetaGroupsAsync({
            client,
            buildId,
          })
        : [];
      const assignedIds = new Set(assignedGroups.map(group => group.id));
      const groupLimit = limitFactory<void>(1);
      const groupResults = await Promise.allSettled(
        requestedGroups.map(group =>
          groupLimit(async () => {
            const label = `${JSON.stringify(group.attributes?.name)} (${group.id})`;
            if (assignedIds.has(group.id)) {
              logger.info(`✅ Group ${label}: build already assigned; no assignment needed.`);
              return;
            }
            if (
              group.attributes?.isInternalGroup === true &&
              group.attributes.hasAccessToAllBuilds === true
            ) {
              logger.info(
                `✅ Group ${label}: automatic access to all builds; no assignment needed.`
              );
              return;
            }
            try {
              await client.postAsync(
                '/v1/builds/:id/relationships/betaGroups',
                {
                  data: [{ type: 'betaGroups', id: group.id }],
                },
                { id: buildId }
              );
            } catch (error) {
              logger.error(`❌ Group ${label}: assignment failed. ${String(error)}`);
              if (isInternalGroupAssignmentError(error)) {
                throw new UserError(
                  'EAS_TESTFLIGHT_INTERNAL_GROUP_ASSIGNMENT_FAILED',
                  "App Store Connect can't add this build to a requested internal TestFlight group. " +
                    "Internal groups that automatically receive new builds can't be assigned to manually. " +
                    'Remove the group from the list, or turn off automatic distribution in App Store Connect. ' +
                    `Manage groups at https://appstoreconnect.apple.com/apps/${app.id}/testflight`,
                  { cause: error }
                );
              }
              throw error;
            }
            logger.info(`✅ Group ${label}: assignment completed.`);
          })
        )
      );
      const groupFailures = groupResults.filter(result => result.status === 'rejected');
      if (missingNames.length) {
        const error = new UserError(
          'EAS_TESTFLIGHT_GROUPS_NOT_FOUND',
          `The following TestFlight group${missingNames.length > 1 ? 's were' : ' was'} not found in App Store Connect: ${missingNames.map(name => `"${name}"`).join(', ')}. Check the group names and try again.`
        );
        logger.error(`❌ ${error.message}`);
        groupFailures.push({ status: 'rejected', reason: error });
      }
      if (groupFailures.length === 1) {
        throw groupFailures[0].reason;
      }
      if (groupFailures.length > 1) {
        throw new AggregateError(
          groupFailures.map(failure => failure.reason),
          `Failed to assign TestFlight groups: ${groupFailures.map(failure => String(failure.reason)).join('; ')}`
        );
      }
    }),
  ]);
  const failures = results.filter(result => result.status === 'rejected');
  if (failures.length === 1) {
    throw failures[0].reason;
  }
  if (failures.length > 1) {
    throw new AggregateError(
      failures.map(failure => failure.reason),
      `Failed to update the TestFlight changelog and groups: ${failures
        .map(failure => String(failure.reason))
        .join('; ')}`
    );
  }
}

// Apple returns a generic 422 code, so match the title or detail too.
function isInternalGroupAssignmentError(error: unknown): boolean {
  if (error instanceof AggregateError) {
    return error.errors.some(isInternalGroupAssignmentError);
  }
  return (
    error instanceof AscApiRequestError &&
    error.status === 422 &&
    error.code === 'ENTITY_UNPROCESSABLE' &&
    (error.responseJson.title === 'Builds cannot be assigned to this internal group.' ||
      error.responseJson.detail === 'Cannot add internal group to a build.')
  );
}
