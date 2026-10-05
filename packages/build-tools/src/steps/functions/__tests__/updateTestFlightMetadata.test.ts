import nock from 'nock';
import { generateKeyPairSync } from 'node:crypto';

import { createGlobalContextMock } from '../../../__tests__/utils/context';
import { createMockLogger } from '../../../__tests__/utils/logger';
import { Sentry } from '../../../sentry';
import { AscApiClient } from '../../utils/ios/AscApiClient';
import {
  createUpdateTestFlightMetadataBuildFunction,
  updateTestFlightMetadataAsync,
} from '../updateTestFlightMetadata';

jest.unmock('node-fetch');
jest.mock('../../../sentry', () => ({ Sentry: { capture: jest.fn() } }));

const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const key = { keyId: 'TESTKEY', privateKey };
const changelog = 'Test "quotes"\n$(not-a-command)';
const options = {
  client: new AscApiClient({ key }),
  buildUploadId: 'upload',
  changelog,
  groups: [] as string[],
  logger: createMockLogger(),
};
const api = () => nock('https://api.appstoreconnect.apple.com');

function mockBuild(
  state = 'COMPLETE',
  buildId: string | null = 'build',
  primaryLocale: string | null = 'en-US'
): void {
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
        data: { id: 'app', attributes: primaryLocale ? { primaryLocale } : {} },
      });
  }
}

function mockAssignedGroups(ids: string[] = []): void {
  api()
    .get('/v1/betaGroups')
    .query({ 'filter[builds]': 'build', limit: '200' })
    .reply(200, { data: ids.map(id => ({ id })) });
}

function mockInternalBuildState(state: string | null = 'READY_FOR_BETA_TESTING'): void {
  api()
    .get('/v1/builds/build/buildBetaDetail')
    .query(true)
    .reply(
      state ? 200 : 503,
      state
        ? { data: { id: 'detail', attributes: { internalBuildState: state } } }
        : { errors: [{ code: 'UNAVAILABLE' }] }
    );
}

beforeAll(() => nock.disableNetConnect());
beforeEach(() => {
  jest.mocked(Sentry.capture).mockClear();
  options.logger = createMockLogger();
  options.client = new AscApiClient({ key });
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
    .query({ 'filter[builds]': 'build', limit: '200' })
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

it.each(['en-US', null])(
  'creates a localization when none exist (primary locale: %s)',
  async primaryLocale => {
    mockBuild('COMPLETE', 'build', primaryLocale);
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
    expect(options.logger.info).toHaveBeenCalledWith(
      `Updating changelog: ${JSON.stringify(changelog)}`
    );
    expect(options.logger.info).toHaveBeenCalledWith(
      expect.stringContaining('Locale "en-US": localization created')
    );
  }
);

it('reads all localization pages and updates existing localizations without replacing them', async () => {
  mockBuild();
  api()
    .get('/v1/builds/build/betaBuildLocalizations')
    .query(true)
    .reply(200, {
      data: [{ id: 'en-US', attributes: { locale: 'en-US' } }],
      links: {
        next: 'https://api.appstoreconnect.apple.com/v1/builds/build/betaBuildLocalizations?limit=200&cursor=next',
      },
    });
  api()
    .get('/v1/builds/build/betaBuildLocalizations')
    .query({ limit: '200', cursor: 'next' })
    .reply(200, { data: [{ id: 'pl', attributes: { locale: 'pl' } }] });
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
      expect.stringContaining(`Locale "${id}" (${id})`)
    );
  }
});

it('updates by ID when Apple omits a localization locale and creates the primary locale', async () => {
  mockBuild();
  api()
    .get('/v1/builds/build/betaBuildLocalizations')
    .query(true)
    .reply(200, { data: [{ id: 'localization' }] });

  api()
    .patch('/v1/betaBuildLocalizations/localization', {
      data: {
        type: 'betaBuildLocalizations',
        id: 'localization',
        attributes: { whatsNew: changelog },
      },
    })
    .reply(200, { data: { id: 'localization' } });
  api()
    .post('/v1/betaBuildLocalizations', {
      data: {
        type: 'betaBuildLocalizations',
        attributes: { locale: 'en-US', whatsNew: changelog },
        relationships: { build: { data: { type: 'builds', id: 'build' } } },
      },
    })
    .reply(201, { data: { id: 'primary' } });
  await updateTestFlightMetadataAsync(options);
});

it('assigns requested groups when hasAccessToAllBuilds is null', async () => {
  mockBuild();
  mockAssignedGroups();
  api()
    .get('/v1/betaGroups')
    .query({ 'filter[app]': 'app', limit: '200' })
    .reply(200, {
      data: [
        {
          id: 'internal',
          attributes: { name: 'Internal', isInternalGroup: true, hasAccessToAllBuilds: false },
        },
        {
          id: 'external',
          attributes: {
            name: 'test external',
            isInternalGroup: false,
            hasAccessToAllBuilds: null,
            publicLinkEnabled: false,
            publicLink: 'https://testflight.apple.com/join/abc',
          },
        },
        {
          id: 'requested-external',
          attributes: { name: 'Beta', isInternalGroup: false, hasAccessToAllBuilds: null },
        },
      ],
    });
  for (const id of ['internal', 'requested-external']) {
    api()
      .post('/v1/builds/build/relationships/betaGroups', {
        data: [{ type: 'betaGroups', id }],
      })
      .reply(204);
  }
  await expect(
    updateTestFlightMetadataAsync({ ...options, changelog: '', groups: ['Internal', 'Beta'] })
  ).resolves.toBeUndefined();
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

it('assigns found groups before reporting missing requested names', async () => {
  mockBuild();
  mockAssignedGroups();
  api()
    .get('/v1/betaGroups')
    .query({ 'filter[app]': 'app', limit: '200' })
    .reply(200, { data: [{ id: 'group', attributes: { name: 'A' } }] });
  api()
    .post('/v1/builds/build/relationships/betaGroups', {
      data: [{ type: 'betaGroups', id: 'group' }],
    })
    .reply(204);
  await expect(
    updateTestFlightMetadataAsync({ ...options, changelog: '', groups: ['A', 'B', 'C'] })
  ).rejects.toThrow(
    'The following TestFlight groups were not found in App Store Connect: "B", "C".'
  );
});

it('attempts all localization changes and reports every failed update', async () => {
  mockBuild();
  api()
    .get('/v1/builds/build/betaBuildLocalizations')
    .query(true)
    .reply(200, {
      data: ['pl', 'fr', 'de'].map(locale => ({ id: locale, attributes: { locale } })),
    });
  for (const id of ['pl', 'fr', 'de']) {
    api()
      .patch(`/v1/betaBuildLocalizations/${id}`)
      .reply(
        id === 'de' ? 200 : 403,
        id === 'de' ? { data: { id } } : { errors: [{ code: `${id}_FAILED` }] }
      );
  }
  api()
    .post('/v1/betaBuildLocalizations', {
      data: {
        type: 'betaBuildLocalizations',
        attributes: { locale: 'en-US', whatsNew: changelog },
        relationships: { build: { data: { type: 'builds', id: 'build' } } },
      },
    })
    .reply(201, { data: { id: 'locale' } });
  await expect(updateTestFlightMetadataAsync(options)).rejects.toThrow(/pl_FAILED.*fr_FAILED/);
  expect(options.logger.error).toHaveBeenCalledWith(expect.stringContaining('"pl" (pl)'));
  expect(options.logger.error).toHaveBeenCalledWith(expect.stringContaining('"fr" (fr)'));
});

it.each([1, 2])('explains automatic internal group rejection (%s errors)', async errorCount => {
  mockBuild();
  mockInternalBuildState();
  mockAssignedGroups();
  api()
    .get('/v1/betaGroups')
    .query({ 'filter[app]': 'app', limit: '200' })
    .reply(200, { data: [{ id: 'group', attributes: { name: 'A' } }] });
  api()
    .post('/v1/builds/build/relationships/betaGroups')
    .reply(422, {
      errors: Array.from({ length: errorCount }, () => ({
        code: 'ENTITY_UNPROCESSABLE',
        title: 'Builds cannot be assigned to this internal group.',
        detail: 'Cannot add internal group to a build.',
      })),
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
  mockInternalBuildState();
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

it.each([false, true])(
  'attempts all groups and reports assignment errors (multiple: %s)',
  async multiple => {
    mockBuild();
    mockInternalBuildState();
    mockAssignedGroups();
    api()
      .get('/v1/betaGroups')
      .query({ 'filter[app]': 'app', limit: '200' })
      .reply(200, { data: ['A', 'B', 'C'].map(id => ({ id, attributes: { name: id } })) });
    api()
      .post('/v1/builds/build/relationships/betaGroups', {
        data: [{ type: 'betaGroups', id: 'A' }],
      })
      .reply(
        multiple ? 403 : 204,
        multiple ? { errors: [{ code: 'FIRST_GROUP_FAILED' }] } : undefined
      );
    api()
      .post('/v1/builds/build/relationships/betaGroups', {
        data: [{ type: 'betaGroups', id: 'B' }],
      })
      .reply(422, { errors: [{ code: 'ENTITY_UNPROCESSABLE', title: 'Partial assignment' }] });
    api()
      .post('/v1/builds/build/relationships/betaGroups', {
        data: [{ type: 'betaGroups', id: 'C' }],
      })
      .reply(204);
    await expect(
      updateTestFlightMetadataAsync({ ...options, changelog: '', groups: ['A', 'B', 'C'] })
    ).rejects.toThrow(multiple ? 'FIRST_GROUP_FAILED' : 'Partial assignment');
    expect(options.logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Group "B" (B): assignment failed.')
    );
  }
);

it('reads all membership pages before assigning groups', async () => {
  mockBuild();
  api()
    .get('/v1/betaGroups')
    .query({ 'filter[app]': 'app', limit: '200' })
    .reply(200, { data: [{ id: 'group', attributes: { name: 'A' } }] });
  api()
    .get('/v1/betaGroups')
    .query({ 'filter[builds]': 'build', limit: '200' })
    .reply(200, {
      data: [],
      links: {
        next: 'https://api.appstoreconnect.apple.com/v1/betaGroups?filter%5Bbuilds%5D=build&limit=200&cursor=next',
      },
    });
  api()
    .get('/v1/betaGroups')
    .query({ 'filter[builds]': 'build', limit: '200', cursor: 'next' })
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

it.each([
  ['MISSING_EXPORT_COMPLIANCE', 'Complete the export compliance questions'],
  ['IN_EXPORT_COMPLIANCE_REVIEW', 'Wait for Apple to approve'],
  ['EXPIRED', 'ASSIGNMENT_FAILED'],
  ['PROCESSING', 'ASSIGNMENT_FAILED'],
  ['READY_FOR_BETA_TESTING', 'ASSIGNMENT_FAILED'],
  ['IN_BETA_TESTING', 'ASSIGNMENT_FAILED'],
  [null, 'ASSIGNMENT_FAILED'],
] as const)(
  'shares one diagnostic lookup across failed assignments (state: %s)',
  async (state, guidance) => {
    mockBuild();
    mockAssignedGroups();
    api()
      .get('/v1/betaGroups')
      .query({ 'filter[app]': 'app', limit: '200' })
      .reply(200, {
        data: ['A', 'B', 'C'].map(id => ({ id, attributes: { name: id } })),
      });
    api()
      .post('/v1/builds/build/relationships/betaGroups', {
        data: [{ type: 'betaGroups', id: 'A' }],
      })
      .reply(403, { errors: [{ code: 'ASSIGNMENT_FAILED' }] });
    mockInternalBuildState(state);
    api()
      .post('/v1/builds/build/relationships/betaGroups', {
        data: [{ type: 'betaGroups', id: 'B' }],
      })
      .reply(422, { errors: [{ code: 'ASSIGNMENT_FAILED' }] });
    // A failed assignment must not prevent the next group from being assigned.
    api()
      .post('/v1/builds/build/relationships/betaGroups', {
        data: [{ type: 'betaGroups', id: 'C' }],
      })
      .reply(204);
    const failure = await updateTestFlightMetadataAsync({
      ...options,
      changelog: '',
      groups: ['A', 'B', 'C'],
    }).catch(error => error);
    expect(failure).toBeInstanceOf(AggregateError);
    expect(failure.errors).toHaveLength(2);
    if (state === 'MISSING_EXPORT_COMPLIANCE' || state === 'IN_EXPORT_COMPLIANCE_REVIEW') {
      expect(failure.errors[0]).toBe(failure.errors[1]);
    } else {
      expect(failure.errors[0]).toMatchObject({ status: 403 });
      expect(failure.errors[1]).toMatchObject({ status: 422 });
    }
    expect(failure.errors[0].message).toContain(guidance);
    expect(
      jest
        .mocked(options.logger.info)
        .mock.calls.filter(([message]) => String(message).includes('internal TestFlight state ='))
    ).toEqual([[`Apple build build: internal TestFlight state = ${state ?? 'UNKNOWN'}.`]]);
    expect(Sentry.capture).toHaveBeenCalledTimes(1);
    expect(Sentry.capture).toHaveBeenCalledWith(
      `TestFlight group assignment failed (state: ${state ?? 'UNKNOWN'})`,
      {
        level: 'error',
        tags: { step: 'eas/update_testflight_metadata', internal_build_state: state ?? 'UNKNOWN' },
        extras: {
          buildId: 'build',
          assignmentError: expect.stringContaining('ASSIGNMENT_FAILED'),
        },
      }
    );
  }
);
