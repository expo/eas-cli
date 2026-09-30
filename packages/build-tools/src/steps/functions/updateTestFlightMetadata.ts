import { SystemError, UserError } from '@expo/eas-build-job';
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
      const token = await AscApiUtils.signTokenAsync({ keyPath });
      await updateTestFlightMetadataAsync({
        client: new AscApiClient({ token, logger: ctx.logger }),
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

  const groupIds: string[] = [];
  if (groups.length) {
    const requestedNames = new Set(groups);
    const foundNames = new Set<string>();
    let response = await client.getAsync('/v1/betaGroups', {
      'filter[app]': app.id,
      limit: 200,
    });
    for (let page = 1; page <= 20; page++) {
      for (const group of response.data) {
        const name = group.attributes?.name;
        if (name && requestedNames.has(name)) {
          foundNames.add(name);
          groupIds.push(group.id);
        }
      }
      if (!response.links?.next) {
        break;
      }
      if (page === 20) {
        throw new SystemError('The TestFlight group list has more than 20 pages.');
      }
      response = await client.getNextPageAsync('/v1/betaGroups', response.links.next);
    }
    const missingNames = [...requestedNames].filter(name => !foundNames.has(name));
    if (missingNames.length) {
      throw new UserError(
        'EAS_TESTFLIGHT_GROUPS_NOT_FOUND',
        `The following TestFlight group${missingNames.length > 1 ? 's were' : ' was'} not found in App Store Connect: ${missingNames.map(name => `"${name}"`).join(', ')}. Check the group names and try again.`
      );
    }
    logger.info(`Found ${groupIds.length} TestFlight group(s).`);
  }

  const limit = limitFactory<void>(1);
  const results = await Promise.allSettled([
    limit(async () => {
      if (!changelog) {
        return;
      }
      logger.info('Updating TestFlight changelog...');
      const primaryLocale = app.attributes?.primaryLocale;
      if (!primaryLocale) {
        throw new SystemError('App Store Connect did not return the app primary locale.');
      }
      const response = await client.getAsync(
        '/v1/builds/:id/betaBuildLocalizations',
        { limit: 200 },
        { id: buildId }
      );
      if (response.links?.next) {
        throw new SystemError(
          'Cannot update all TestFlight localizations in one page. Update the changelog in App Store Connect.'
        );
      }
      if (response.data.some(localization => !localization.attributes?.locale)) {
        throw new SystemError('App Store Connect did not return a TestFlight localization locale.');
      }
      for (const localization of response.data) {
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
      }
      if (!response.data.some(localization => localization.attributes?.locale === primaryLocale)) {
        await client.postAsync('/v1/betaBuildLocalizations', {
          data: {
            type: 'betaBuildLocalizations',
            attributes: { locale: primaryLocale, whatsNew: changelog },
            relationships: { build: { data: { type: 'builds', id: buildId } } },
          },
        });
      }
    }),
    limit(async () => {
      if (!groupIds.length) {
        return;
      }
      logger.info(`Adding Apple build to ${groupIds.length} TestFlight group(s)...`);
      try {
        await client.postAsync(
          '/v1/builds/:id/relationships/betaGroups',
          {
            data: groupIds.map(id => ({ type: 'betaGroups', id })),
          },
          { id: buildId }
        );
      } catch (error) {
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
  return (
    error instanceof AscApiRequestError &&
    error.status === 422 &&
    error.responseJson.errors.some(
      ({ code, title, detail }) =>
        code === 'ENTITY_UNPROCESSABLE' &&
        (title === 'Builds cannot be assigned to this internal group.' ||
          detail === 'Cannot add internal group to a build.')
    )
  );
}
