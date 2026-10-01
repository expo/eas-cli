import nock from 'nock';

import { createGlobalContextMock } from '../../../__tests__/utils/context';
import { createMockLogger } from '../../../__tests__/utils/logger';
import { AscApiClient } from '../../utils/ios/AscApiClient';
import {
  createUpdateTestFlightMetadataBuildFunction,
  updateTestFlightMetadataAsync,
} from '../updateTestFlightMetadata';

jest.unmock('node-fetch');

const client = new AscApiClient({ token: 'test-token' });
const changelog = 'Test "quotes"\n$(not-a-command)';
const options = {
  client,
  buildUploadId: 'upload',
  changelog,
  groups: [] as string[],
  logger: createMockLogger(),
};
const api = () => nock('https://api.appstoreconnect.apple.com');

function mockBuild(state = 'COMPLETE', buildId: string | null = 'build'): void {
  api()
    .get('/v1/buildUploads/upload')
    .query(true)
    .reply(200, {
      data: {
        type: 'buildUploads',
        id: 'upload',
        attributes: { state: { state } },
        relationships: { build: { data: buildId ? { type: 'builds', id: buildId } : null } },
      },
    });
  if (state === 'COMPLETE' && buildId) {
    api()
      .get(`/v1/builds/${buildId}/app`)
      .query(true)
      .reply(200, {
        data: { id: 'app', attributes: { primaryLocale: 'en-US' } },
      });
  }
}

function mockAssignedGroups(ids: string[] = []): void {
  api()
    .get('/v1/betaGroups')
    .query({ 'filter[app]': 'app', 'filter[builds]': 'build', limit: '200' })
    .reply(200, { data: ids.map(id => ({ id })) });
}

beforeAll(() => nock.disableNetConnect());
beforeEach(() => {
  options.logger = createMockLogger();
});
afterAll(() => nock.enableNetConnect());
afterEach(() => {
  try {
    expect(nock.pendingMocks()).toEqual([]);
  } finally {
    nock.cleanAll();
  }
});

it('accepts group arrays and preserves changelog input without shell parsing', async () => {
  const fn = createUpdateTestFlightMetadataBuildFunction();
  const spy = jest.spyOn(fn, 'fn').mockImplementation(async (_ctx, { inputs }) => {
    expect(inputs.groups.value).toEqual(['A, "B"']);
    expect(inputs.changelog.value).toBe(changelog);
  });
  const step = fn.createBuildStepFromFunctionCall(createGlobalContextMock(), {
    callInputs: {
      asc_api_key_path: '/tmp/key.json',
      build_upload_id: 'upload',
      groups: ['A, "B"'],
      changelog,
    },
  });
  await step.executeAsync();
  expect(spy).toHaveBeenCalled();
});

it('uses empty metadata defaults', async () => {
  const fn = createUpdateTestFlightMetadataBuildFunction();
  const spy = jest.spyOn(fn, 'fn').mockImplementation(async (_ctx, { inputs }) => {
    expect(inputs.groups.value).toEqual([]);
    expect(inputs.changelog.value).toBe('');
  });
  const step = fn.createBuildStepFromFunctionCall(createGlobalContextMock(), {
    callInputs: { asc_api_key_path: '/tmp/key.json', build_upload_id: 'upload' },
  });
  await step.executeAsync();
  expect(spy).toHaveBeenCalled();
});

it('skips automatic internal groups and groups that already contain the build', async () => {
  mockBuild();
  api()
    .get('/v1/betaGroups')
    .query({ 'filter[app]': 'app', limit: '200' })
    .reply(200, {
      data: [
        {
          id: 'automatic',
          attributes: { name: 'Internal', isInternalGroup: true, hasAccessToAllBuilds: true },
        },
        { id: 'assigned', attributes: { name: 'QA' } },
        {
          id: 'manual',
          attributes: { name: 'External', isInternalGroup: false, hasAccessToAllBuilds: true },
        },
      ],
    });
  api()
    .get('/v1/betaGroups')
    .query({ 'filter[app]': 'app', 'filter[builds]': 'build', limit: '200' })
    .reply(200, { data: [{ id: 'assigned', attributes: { name: 'QA' } }] });
  api()
    .post('/v1/builds/build/relationships/betaGroups', {
      data: [{ type: 'betaGroups', id: 'manual' }],
    })
    .reply(204);
  await updateTestFlightMetadataAsync({
    ...options,
    changelog: '',
    groups: ['Internal', 'QA', 'External'],
  });
  expect(options.logger.info).toHaveBeenCalledWith(
    expect.stringContaining('"Internal" (automatic): automatic access')
  );
  expect(options.logger.info).toHaveBeenCalledWith(
    expect.stringContaining('"QA" (assigned): build already assigned')
  );
  expect(options.logger.info).toHaveBeenCalledWith(
    expect.stringContaining('"External" (manual): assignment completed')
  );
});

it('creates the primary localization when none exist', async () => {
  mockBuild();
  api().get('/v1/builds/build/betaBuildLocalizations').query(true).reply(200, { data: [] });
  api()
    .post('/v1/betaBuildLocalizations', {
      data: {
        type: 'betaBuildLocalizations',
        attributes: { locale: 'en-US', whatsNew: changelog },
        relationships: { build: { data: { type: 'builds', id: 'build' } } },
      },
    })
    .reply(201, { data: { id: 'locale' } });
  await updateTestFlightMetadataAsync(options);
  expect(options.logger.info).toHaveBeenCalledWith(`Changelog: ${JSON.stringify(changelog)}`);
  expect(options.logger.info).toHaveBeenCalledWith(
    expect.stringContaining('Locale "en-US": localization created')
  );
});

it('updates all existing localizations without replacing them', async () => {
  mockBuild();
  api()
    .get('/v1/builds/build/betaBuildLocalizations')
    .query(true)
    .reply(200, {
      data: ['en-US', 'pl'].map(locale => ({ id: locale, attributes: { locale } })),
    });
  for (const id of ['en-US', 'pl']) {
    api()
      .patch(`/v1/betaBuildLocalizations/${id}`, {
        data: { type: 'betaBuildLocalizations', id, attributes: { whatsNew: changelog } },
      })
      .reply(200, { data: { id } });
  }
  await updateTestFlightMetadataAsync(options);
  for (const id of ['en-US', 'pl']) {
    expect(options.logger.info).toHaveBeenCalledWith(
      expect.stringContaining(`locale "${id}" (${id})`)
    );
  }
});

it('stops before changing metadata when Apple omits a localization locale', async () => {
  mockBuild();
  api()
    .get('/v1/builds/build/betaBuildLocalizations')
    .query(true)
    .reply(200, { data: [{ id: 'localization' }] });

  await expect(updateTestFlightMetadataAsync(options)).rejects.toThrow(
    'App Store Connect did not return a TestFlight localization locale.'
  );
});

it('adds groups without changing changelog or submitting beta review', async () => {
  mockBuild();
  mockAssignedGroups();
  api()
    .get('/v1/betaGroups')
    .query({ 'filter[app]': 'app', limit: '200' })
    .reply(200, { data: [{ id: 'group', attributes: { name: 'A, "B"' } }] });
  api()
    .post('/v1/builds/build/relationships/betaGroups', {
      data: [{ type: 'betaGroups', id: 'group' }],
    })
    .reply(204);
  await updateTestFlightMetadataAsync({ ...options, changelog: '', groups: ['A, "B"', 'A, "B"'] });
});

it('reports missing groups independently of the changelog task', async () => {
  mockBuild();
  api().get('/v1/builds/build/betaBuildLocalizations').query(true).reply(200, { data: [] });
  api()
    .post('/v1/betaBuildLocalizations')
    .reply(201, { data: { id: 'locale' } });
  api()
    .get('/v1/betaGroups')
    .query({ 'filter[app]': 'app', limit: '200' })
    .reply(200, { data: [] });
  await expect(updateTestFlightMetadataAsync({ ...options, groups: ['missing'] })).rejects.toThrow(
    'The following TestFlight group was not found in App Store Connect: "missing".'
  );
});

it('reads all pages and adds every group with a requested name', async () => {
  mockBuild();
  mockAssignedGroups();
  api()
    .get('/v1/betaGroups')
    .query({ 'filter[app]': 'app', limit: '200' })
    .reply(200, {
      data: [{ id: 'first', attributes: { name: 'A' } }],
      links: {
        next: 'https://api.appstoreconnect.apple.com/v1/betaGroups?filter%5Bapp%5D=app&limit=200&cursor=page-2',
      },
    });
  api()
    .get('/v1/betaGroups')
    .query({ 'filter[app]': 'app', limit: '200', cursor: 'page-2' })
    .reply(200, {
      data: [
        { id: 'second', attributes: { name: 'A' } },
        { id: 'other', attributes: { name: 'B' } },
      ],
    });
  for (const id of ['first', 'second']) {
    api()
      .post('/v1/builds/build/relationships/betaGroups', {
        data: [{ type: 'betaGroups', id }],
      })
      .reply(204);
  }
  await updateTestFlightMetadataAsync({ ...options, changelog: '', groups: ['A'] });
});

it('fails without adding found groups when another requested name is missing', async () => {
  mockBuild();
  api()
    .get('/v1/betaGroups')
    .query({ 'filter[app]': 'app', limit: '200' })
    .reply(200, { data: [{ id: 'group', attributes: { name: 'A' } }] });
  await expect(
    updateTestFlightMetadataAsync({ ...options, changelog: '', groups: ['A', 'B', 'C'] })
  ).rejects.toThrow(
    'The following TestFlight groups were not found in App Store Connect: "B", "C".'
  );
});

it('explains when Apple rejects an internal group with automatic distribution', async () => {
  mockBuild();
  mockAssignedGroups();
  api()
    .get('/v1/betaGroups')
    .query({ 'filter[app]': 'app', limit: '200' })
    .reply(200, { data: [{ id: 'group', attributes: { name: 'A' } }] });
  api()
    .post('/v1/builds/build/relationships/betaGroups')
    .reply(422, {
      errors: [
        {
          code: 'ENTITY_UNPROCESSABLE',
          title: 'Builds cannot be assigned to this internal group.',
          detail: 'Cannot add internal group to a build.',
        },
      ],
    });
  await expect(
    updateTestFlightMetadataAsync({ ...options, changelog: '', groups: ['A'] })
  ).rejects.toThrow(
    "App Store Connect can't add this build to a requested internal TestFlight group."
  );
});

it('stops after 20 group pages', async () => {
  mockBuild();
  const next =
    'https://api.appstoreconnect.apple.com/v1/betaGroups?filter%5Bapp%5D=app&limit=200&cursor=next';
  api()
    .get('/v1/betaGroups')
    .query({ 'filter[app]': 'app', limit: '200' })
    .reply(200, { data: [], links: { next } });
  api()
    .get('/v1/betaGroups')
    .query({ 'filter[app]': 'app', limit: '200', cursor: 'next' })
    .times(19)
    .reply(200, { data: [], links: { next } });
  await expect(
    updateTestFlightMetadataAsync({ ...options, changelog: '', groups: ['A'] })
  ).rejects.toThrow('We only support TestFlight group lists with up to 20 pages');
});

it('tries group assignment if the changelog update fails', async () => {
  mockBuild();
  mockAssignedGroups();
  api()
    .get('/v1/betaGroups')
    .query({ 'filter[app]': 'app', limit: '200' })
    .reply(200, { data: [{ id: 'group', attributes: { name: 'A' } }] });
  api().get('/v1/builds/build/betaBuildLocalizations').query(true).reply(200, { data: [] });
  api()
    .post('/v1/betaBuildLocalizations')
    .reply(403, { errors: [{ code: 'FORBIDDEN', detail: 'Not allowed' }] });
  api()
    .post('/v1/builds/build/relationships/betaGroups', {
      data: [{ type: 'betaGroups', id: 'group' }],
    })
    .reply(204);
  await expect(updateTestFlightMetadataAsync({ ...options, groups: ['A'] })).rejects.toThrow('403');
});

it('reports both write failures', async () => {
  mockBuild();
  mockAssignedGroups();
  api()
    .get('/v1/betaGroups')
    .query({ 'filter[app]': 'app', limit: '200' })
    .reply(200, { data: [{ id: 'group', attributes: { name: 'A' } }] });
  api().get('/v1/builds/build/betaBuildLocalizations').query(true).reply(200, { data: [] });
  api()
    .post('/v1/betaBuildLocalizations')
    .reply(403, { errors: [{ code: 'CHANGELOG_FAILED' }] });
  api()
    .post('/v1/builds/build/relationships/betaGroups')
    .reply(403, { errors: [{ code: 'GROUPS_FAILED' }] });
  await expect(updateTestFlightMetadataAsync({ ...options, groups: ['A'] })).rejects.toThrow(
    /CHANGELOG_FAILED.*GROUPS_FAILED/
  );
});

it('does not accept a partial assignment after an error', async () => {
  mockBuild();
  mockAssignedGroups();
  api()
    .get('/v1/betaGroups')
    .query({ 'filter[app]': 'app', limit: '200' })
    .reply(200, { data: ['A', 'B'].map(id => ({ id, attributes: { name: id } })) });
  api()
    .post('/v1/builds/build/relationships/betaGroups', { data: [{ type: 'betaGroups', id: 'A' }] })
    .reply(204);
  api()
    .post('/v1/builds/build/relationships/betaGroups', { data: [{ type: 'betaGroups', id: 'B' }] })
    .reply(422, { errors: [{ code: 'ENTITY_UNPROCESSABLE', title: 'Partial assignment' }] });
  await expect(
    updateTestFlightMetadataAsync({ ...options, changelog: '', groups: ['A', 'B'] })
  ).rejects.toThrow('Partial assignment');
});

it('reads all membership pages before assigning groups', async () => {
  mockBuild();
  api()
    .get('/v1/betaGroups')
    .query({ 'filter[app]': 'app', limit: '200' })
    .reply(200, { data: [{ id: 'group', attributes: { name: 'A' } }] });
  api()
    .get('/v1/betaGroups')
    .query({ 'filter[app]': 'app', 'filter[builds]': 'build', limit: '200' })
    .reply(200, {
      data: [],
      links: {
        next: 'https://api.appstoreconnect.apple.com/v1/betaGroups?filter%5Bapp%5D=app&filter%5Bbuilds%5D=build&limit=200&cursor=next',
      },
    });
  api()
    .get('/v1/betaGroups')
    .query({ 'filter[app]': 'app', 'filter[builds]': 'build', limit: '200', cursor: 'next' })
    .reply(200, { data: [{ id: 'group' }] });
  await updateTestFlightMetadataAsync({ ...options, changelog: '', groups: ['A'] });
});

it.each(['PROCESSING', 'FAILED'])('rejects a %s upload', async state => {
  mockBuild(state);
  await expect(updateTestFlightMetadataAsync(options)).rejects.toThrow('not ready');
});

it('rejects a completed upload without its build relationship', async () => {
  mockBuild('COMPLETE', null);
  await expect(updateTestFlightMetadataAsync(options)).rejects.toThrow('not ready');
});

it('propagates Apple write failures', async () => {
  mockBuild();
  api().get('/v1/builds/build/betaBuildLocalizations').query(true).reply(200, { data: [] });
  api()
    .post('/v1/betaBuildLocalizations')
    .reply(403, { errors: [{ code: 'FORBIDDEN', detail: 'Not allowed' }] });
  await expect(updateTestFlightMetadataAsync(options)).rejects.toThrow('403');
});
