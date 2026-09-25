import nock from 'nock';

import { createGlobalContextMock } from '../../../__tests__/utils/context';
import { AscApiClient } from '../../utils/ios/AscApiClient';
import {
  createUpdateTestFlightMetadataBuildFunction,
  updateTestFlightMetadataAsync,
} from '../updateTestFlightMetadata';

jest.unmock('node-fetch');

const client = new AscApiClient({ token: 'test-token' });
const changelog = 'Test "quotes"\n$(not-a-command)';
const options = { client, buildUploadId: 'upload', changelog, groups: [] as string[] };
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

beforeAll(() => nock.disableNetConnect());
afterAll(() => nock.enableNetConnect());
afterEach(() => {
  expect(nock.pendingMocks()).toEqual([]);
  nock.cleanAll();
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
});

it('adds groups without changing changelog or submitting beta review', async () => {
  mockBuild();
  api()
    .get('/v1/betaGroups')
    .query({ 'filter[app]': 'app', 'filter[name]': 'A, "B"', limit: '200' })
    .reply(200, { data: [{ id: 'group', attributes: { name: 'A, "B"' } }] });
  api()
    .post('/v1/builds/build/relationships/betaGroups', {
      data: [{ type: 'betaGroups', id: 'group' }],
    })
    .reply(204);
  await updateTestFlightMetadataAsync({ ...options, changelog: '', groups: ['A, "B"', 'A, "B"'] });
});

it('fails before writes when a group cannot be found', async () => {
  mockBuild();
  api().get('/v1/betaGroups').query(true).reply(200, { data: [] });
  await expect(updateTestFlightMetadataAsync({ ...options, groups: ['missing'] })).rejects.toThrow(
    'Cannot select TestFlight group'
  );
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
