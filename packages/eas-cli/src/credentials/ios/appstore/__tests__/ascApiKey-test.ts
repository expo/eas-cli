import { ApiKey, ApiKeyType, UserRole } from '@expo/apple-utils';

import { asMock } from '../../../../__tests__/utils';
import {
  createAscApiKeyAsync,
  getAscApiKeyAsync,
  listAscApiKeysAsync,
  revokeAscApiKeyAsync,
} from '../ascApiKey';
import { getRequestContext } from '../authenticate';

jest.mock('@expo/apple-utils');
jest.mock('../authenticate');
jest.mock('../../../../ora');

const mockTeam = {
  id: 'test-id',
  name: 'test-name',
};
const mockAuthCtx = {
  appleId: 'test-appleId',
  team: mockTeam,
};

const mockApiKey = {
  type: 'apiKeys',
  id: 'NL67AN9Q6Q',
  attributes: {
    nickname: 'ejb-apple-utils-admin',
    lastUsed: '2021-06-28T12:30:41-07:00',
    revokingDate: null,
    isActive: true,
    canDownload: false,
    privateKey: null,
    roles: ['ADMIN'],
    allAppsVisible: true,
    keyType: 'PUBLIC_API',
  },
  downloadAsync: jest.fn(() => 'super secret'),
  revokeAsync: jest.fn(() => mockApiKey),
} as unknown as ApiKey;

const mockAscApiKeyInfo = {
  issuerId: undefined,
  keyId: 'NL67AN9Q6Q',
  name: 'ejb-apple-utils-admin',
  roles: ['ADMIN'],
  teamId: 'test-id',
  teamName: 'test-name',
};

beforeEach(() => {
  jest.clearAllMocks();
});

test(`listAscApiKeysAsync`, async () => {
  const mockRequestContext = {};
  jest.spyOn(ApiKey, 'getAsync').mockImplementation(async () => []);
  asMock(getRequestContext).mockImplementation(() => mockRequestContext);
  const result = await listAscApiKeysAsync(mockAuthCtx);
  expect(ApiKey.getAsync).toHaveBeenLastCalledWith(mockRequestContext);
  expect(result).toEqual([]);
});

test(`getAscApiKeyAsync`, async () => {
  const mockRequestContext = {};
  jest.spyOn(ApiKey, 'infoAsync').mockImplementation(async () => mockApiKey);
  asMock(getRequestContext).mockImplementation(() => mockRequestContext);
  const result = await getAscApiKeyAsync(mockAuthCtx, 'test-key-id');
  expect(ApiKey.infoAsync).toHaveBeenLastCalledWith(mockRequestContext, { id: 'test-key-id' });
  expect(result).toEqual(mockAscApiKeyInfo);
});

test(`createAscApiKeyAsync`, async () => {
  const mockRequestContext = {};
  jest.spyOn(ApiKey, 'createAsync').mockImplementation(async () => mockApiKey);
  asMock(getRequestContext).mockImplementation(() => mockRequestContext);
  const result = await createAscApiKeyAsync(mockAuthCtx, { name: 'test-name' });
  expect(ApiKey.createAsync).toHaveBeenLastCalledWith(mockRequestContext, {
    nickname: 'test-name',
    allAppsVisible: true,
    roles: [UserRole.ADMIN],
    keyType: ApiKeyType.PUBLIC_API,
  });
  expect(result).toEqual({ ...mockAscApiKeyInfo, keyP8: 'super secret' });
});

test(`revokeAscApiKeyAsync`, async () => {
  const mockRequestContext = {};
  jest.spyOn(ApiKey, 'infoAsync').mockImplementation(async () => mockApiKey);
  asMock(getRequestContext).mockImplementation(() => mockRequestContext);
  const result = await revokeAscApiKeyAsync(mockAuthCtx, 'test-key-id');
  expect(ApiKey.infoAsync).toHaveBeenLastCalledWith(mockRequestContext, {
    id: 'test-key-id',
  });
  expect(mockApiKey.revokeAsync).toBeCalled();
  expect(result).toEqual(mockAscApiKeyInfo);
});
