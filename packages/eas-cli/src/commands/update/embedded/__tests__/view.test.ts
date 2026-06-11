import { CombinedError } from '@urql/core';

import { getMockOclifConfig } from '../../../../__tests__/commands/utils';
import { ExpoGraphqlClient } from '../../../../commandUtils/context/contextUtils/createGraphqlClient';
import { AppPlatform } from '../../../../graphql/generated';
import {
  EmbeddedUpdateFragment,
  EmbeddedUpdateQuery,
  isEmbeddedUpdateNotFoundError,
} from '../../../../graphql/queries/EmbeddedUpdateQuery';
import Log from '../../../../log';
import * as json from '../../../../utils/json';
import UpdateEmbeddedView from '../view';

jest.mock('../../../../graphql/queries/EmbeddedUpdateQuery', () => ({
  EmbeddedUpdateQuery: { viewByIdAsync: jest.fn() },
  isEmbeddedUpdateNotFoundError: jest.fn(),
}));
jest.mock('../../../../log');
jest.mock('../../../../utils/json');

const mockView = jest.mocked(EmbeddedUpdateQuery.viewByIdAsync);
const mockIsNotFound = jest.mocked(isEmbeddedUpdateNotFoundError);
const mockLogLog = jest.mocked(Log.log);
const mockEnableJsonOutput = jest.mocked(json.enableJsonOutput);
const mockPrintJson = jest.mocked(json.printJsonOnlyOutput);

const VALID_UUID = 'a1b2c3d4-1234-4000-8000-000000000000';

const MOCK_CONTEXT = {
  projectId: 'project-123',
  loggedIn: { graphqlClient: {} as ExpoGraphqlClient },
};

const MOCK_EMBEDDED_UPDATE: EmbeddedUpdateFragment = {
  id: VALID_UUID,
  platform: AppPlatform.Ios,
  runtimeVersion: '1.0.0',
  channel: 'production',
  createdAt: '2026-05-29T00:00:00Z',
  launchAsset: {
    id: 'asset-1',
    fileSize: 1024,
    finalFileSize: 768,
    fileSHA256: 'abc123',
  },
};

describe(UpdateEmbeddedView, () => {
  const mockConfig = getMockOclifConfig();

  beforeEach(() => {
    jest.clearAllMocks();
    mockView.mockResolvedValue(MOCK_EMBEDDED_UPDATE);
    mockIsNotFound.mockReturnValue(false);
  });

  function createCommand(argv: string[]): UpdateEmbeddedView {
    const command = new UpdateEmbeddedView(argv, mockConfig);
    // @ts-expect-error getContextAsync is protected
    jest.spyOn(command, 'getContextAsync').mockResolvedValue(MOCK_CONTEXT);
    return command;
  }

  it('prints formatted details on success', async () => {
    await createCommand([VALID_UUID]).run();

    expect(mockView).toHaveBeenCalledWith(MOCK_CONTEXT.loggedIn.graphqlClient, {
      embeddedUpdateId: VALID_UUID,
      appId: MOCK_CONTEXT.projectId,
    });
    // Header line + body line
    expect(mockLogLog).toHaveBeenCalledTimes(2);
    expect(mockLogLog.mock.calls[0][0]).toContain('Embedded update');
    expect(mockLogLog.mock.calls[1][0]).toContain(VALID_UUID);
    expect(mockLogLog.mock.calls[1][0]).toContain('Bundle size');
    expect(mockLogLog.mock.calls[1][0]).toContain('Bundle SHA-256');
  });

  it('--json prints the raw embedded update and skips formatted output', async () => {
    await createCommand([VALID_UUID, '--json']).run();

    expect(mockEnableJsonOutput).toHaveBeenCalled();
    expect(mockPrintJson).toHaveBeenCalledWith(MOCK_EMBEDDED_UPDATE);
    expect(mockLogLog).not.toHaveBeenCalled();
  });

  it('exits with a friendly message when the server returns NOT_FOUND', async () => {
    const notFound = new CombinedError({ graphQLErrors: [] });
    mockView.mockRejectedValue(notFound);
    mockIsNotFound.mockReturnValue(true);

    await expect(createCommand([VALID_UUID]).run()).rejects.toThrow();
    expect(mockIsNotFound).toHaveBeenCalledWith(notFound);
  });

  it('rethrows unexpected errors', async () => {
    const boom = new Error('boom');
    mockView.mockRejectedValue(boom);
    mockIsNotFound.mockReturnValue(false);

    await expect(createCommand([VALID_UUID]).run()).rejects.toThrow('boom');
  });

  it('renders bundle size from finalFileSize when present', async () => {
    mockView.mockResolvedValue({
      ...MOCK_EMBEDDED_UPDATE,
      launchAsset: { id: 'asset-x', fileSize: 2048, finalFileSize: 768, fileSHA256: 'abc' },
    });
    await createCommand([VALID_UUID]).run();
    // 768 B; not 2.0 KB (which would be fileSize).
    expect(mockLogLog.mock.calls[1][0]).toContain('768 B');
  });

  it('falls back to fileSize when finalFileSize is null', async () => {
    mockView.mockResolvedValue({
      ...MOCK_EMBEDDED_UPDATE,
      launchAsset: { id: 'asset-y', fileSize: 2048, finalFileSize: null, fileSHA256: 'abc' },
    });
    await createCommand([VALID_UUID]).run();
    expect(mockLogLog.mock.calls[1][0]).toContain('2.0 KB');
  });

  it('shows runtime version, channel, and SHA-256 in the body', async () => {
    await createCommand([VALID_UUID]).run();
    const body = String(mockLogLog.mock.calls[1][0]);
    expect(body).toContain('1.0.0');
    expect(body).toContain('production');
    expect(body).toContain('abc123');
  });

  it('shows a relative-time hint in the Created at row', async () => {
    await createCommand([VALID_UUID]).run();
    expect(mockLogLog.mock.calls[1][0]).toMatch(/\(.+ago\)/);
  });

  it('passes the project id and uuid through to viewByIdAsync', async () => {
    await createCommand([VALID_UUID]).run();
    expect(mockView).toHaveBeenCalledWith(MOCK_CONTEXT.loggedIn.graphqlClient, {
      embeddedUpdateId: VALID_UUID,
      appId: MOCK_CONTEXT.projectId,
    });
  });
});
