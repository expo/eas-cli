import fs from 'fs-extra';
import nock from 'nock';
import { generateKeyPairSync } from 'node:crypto';

import {
  createCustomBuildContextMock,
  createGlobalContextMock,
} from '../../../__tests__/utils/context';
import { getEasFunctions } from '../../easFunctions';

jest.unmock('node-fetch');
const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const api = () => nock('https://api.appstoreconnect.apple.com');

beforeAll(() => nock.disableNetConnect());
afterAll(() => nock.enableNetConnect());
beforeEach(async () => {
  await fs.outputJson('/project/key.json', {
    key_id: 'TESTKEY',
    key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  });
});
afterEach(() => {
  try {
    expect(nock.pendingMocks()).toEqual([]);
  } finally {
    nock.cleanAll();
  }
});

async function submitAsync(): Promise<void> {
  const fn = getEasFunctions(createCustomBuildContextMock()).find(
    fn => fn.getFullId() === 'eas/submit_testflight_beta_review'
  )!;
  await fn
    .createBuildStepFromFunctionCall(
      createGlobalContextMock({ projectTargetDirectory: '/project' }),
      {
        callInputs: { asc_api_key_path: 'key.json', build_upload_id: 'upload' },
      }
    )
    .executeAsync();
}

function mockBuild(state = 'COMPLETE'): void {
  api()
    .get('/v1/buildUploads/upload')
    .query(true)
    .reply(200, {
      data: {
        type: 'buildUploads',
        id: 'upload',
        attributes: { state: { state } },
        relationships: { build: { data: { type: 'builds', id: 'build' } } },
      },
    });
}

function mockReviewState(externalBuildState: string): void {
  api()
    .get('/v1/builds/build/buildBetaDetail')
    .query(true)
    .reply(200, {
      data: {
        id: 'detail',
        attributes: { internalBuildState: 'READY_FOR_BETA_TESTING', externalBuildState },
      },
    });
}

it.each(['READY_FOR_BETA_SUBMISSION', 'IN_BETA_REVIEW', 'READY_FOR_BETA_TESTING'])(
  'submits for review only when needed (%s)',
  async state => {
    mockBuild();
    mockReviewState(state);
    if (state === 'READY_FOR_BETA_SUBMISSION') {
      api()
        .post('/v1/betaAppReviewSubmissions', {
          data: {
            type: 'betaAppReviewSubmissions',
            relationships: { build: { data: { type: 'builds', id: 'build' } } },
          },
        })
        .reply(201, { data: { id: 'review', type: 'betaAppReviewSubmissions' } });
    }
    await expect(submitAsync()).resolves.toBeUndefined();
  }
);

it('does not submit an unprocessed build', async () => {
  mockBuild('PROCESSING');
  await expect(submitAsync()).rejects.toThrow('not ready for beta review');
});

it('does not treat an arbitrary conflict as success', async () => {
  mockBuild();
  mockReviewState('READY_FOR_BETA_SUBMISSION');
  api()
    .post('/v1/betaAppReviewSubmissions')
    .reply(409, {
      errors: [{ status: '409', code: 'STATE_ERROR', detail: 'Missing beta review information' }],
    });
  await expect(submitAsync()).rejects.toThrow('Missing beta review information');
});
