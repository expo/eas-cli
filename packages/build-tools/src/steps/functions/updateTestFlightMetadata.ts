import { BuildFunction, BuildStepInput, BuildStepInputValueTypeName } from '@expo/steps';
import fs from 'fs-extra';
import * as jose from 'jose';
import path from 'node:path';
import { z } from 'zod';

import { AscApiClient } from '../utils/ios/AscApiClient';

export function createUpdateTestFlightMetadataBuildFunction(): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'update_testflight_metadata',
    name: 'Update TestFlight metadata',
    __metricsId: 'eas/update_testflight_metadata',
    inputProviders: [
      ...['asc_api_key_path', 'build_upload_id'].map(id =>
        BuildStepInput.createProvider({
          id,
          required: true,
          allowedValueTypeName: BuildStepInputValueTypeName.STRING,
        })
      ),
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
      const keyPath = path.resolve(
        ctx.workingDirectory,
        z.string().parse(inputs.asc_api_key_path.value)
      );
      const key = z
        .object({ issuer_id: z.string().nullish(), key_id: z.string(), key: z.string() })
        .parse(await fs.readJson(keyPath));
      const jwt = new jose.SignJWT({})
        .setProtectedHeader({ alg: 'ES256', kid: key.key_id })
        .setAudience('appstoreconnect-v1')
        .setExpirationTime('20m');
      if (key.issuer_id) {
        jwt.setIssuer(key.issuer_id);
      } else {
        jwt.setSubject('user');
      }
      const token = await jwt.sign(await jose.importPKCS8(key.key, 'ES256'));
      await updateTestFlightMetadataAsync({
        client: new AscApiClient({ token, logger: ctx.logger }),
        buildUploadId: z.string().parse(inputs.build_upload_id.value),
        changelog: z.string().parse(inputs.changelog.value),
        groups: z.array(z.string()).parse(inputs.groups.value),
      });
      ctx.logger.info('TestFlight metadata updated. No beta review was requested.');
    },
  });
}

export async function updateTestFlightMetadataAsync({
  client,
  buildUploadId,
  changelog,
  groups,
}: {
  client: AscApiClient;
  buildUploadId: string;
  changelog: string;
  groups: string[];
}): Promise<void> {
  const { data: upload } = await client.getAsync(
    '/v1/buildUploads/:id',
    {
      'fields[buildUploads]': ['state', 'build'],
      include: ['build'],
    },
    { id: buildUploadId }
  );
  const buildId = upload.relationships?.build.data?.id;
  if (upload.attributes.state.state !== 'COMPLETE' || !buildId) {
    throw new Error(
      'The uploaded build is not ready for TestFlight metadata. Run eas/upload_to_asc with wait_for_processing: true first.'
    );
  }
  const { data: app } = await client.getAsync('/v1/builds/:id/app', {}, { id: buildId });

  // Resolve every group before changing metadata, so a misspelled name cannot cause a partial update.
  const groupIds: string[] = [];
  for (const name of new Set(groups)) {
    const response = await client.getAsync('/v1/betaGroups', {
      'filter[app]': app.id,
      'filter[name]': name,
      limit: 200,
    });
    const matches = response.data.filter(group => group.attributes.name === name);
    if (response.links?.next || matches.length !== 1) {
      throw new Error(
        `Cannot select TestFlight group "${name}". Check that exactly one group with this name exists for the app.`
      );
    }
    groupIds.push(matches[0].id);
  }

  if (changelog) {
    const response = await client.getAsync(
      '/v1/builds/:id/betaBuildLocalizations',
      { limit: 200 },
      { id: buildId }
    );
    if (response.links?.next) {
      throw new Error(
        'Cannot update all TestFlight localizations in one page. Update the changelog in App Store Connect.'
      );
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
    if (
      !response.data.some(
        localization => localization.attributes.locale === app.attributes.primaryLocale
      )
    ) {
      await client.postAsync('/v1/betaBuildLocalizations', {
        data: {
          type: 'betaBuildLocalizations',
          attributes: { locale: app.attributes.primaryLocale, whatsNew: changelog },
          relationships: { build: { data: { type: 'builds', id: buildId } } },
        },
      });
    }
  }
  if (groupIds.length) {
    await client.postAsync(
      '/v1/builds/:id/relationships/betaGroups',
      {
        data: groupIds.map(id => ({ type: 'betaGroups', id })),
      },
      { id: buildId }
    );
  }
}
