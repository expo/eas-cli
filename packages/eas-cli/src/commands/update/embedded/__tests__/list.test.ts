import { getMockOclifConfig } from '../../../../__tests__/commands/utils';
import { ExpoGraphqlClient } from '../../../../commandUtils/context/contextUtils/createGraphqlClient';
import { AppPlatform } from '../../../../graphql/generated';
import { ChannelQuery } from '../../../../graphql/queries/ChannelQuery';
import {
  EmbeddedUpdateFragment,
  EmbeddedUpdateQuery,
} from '../../../../graphql/queries/EmbeddedUpdateQuery';
import Log from '../../../../log';
import { selectAsync } from '../../../../prompts';
import * as json from '../../../../utils/json';
import UpdateEmbeddedList from '../list';

jest.mock('../../../../graphql/queries/EmbeddedUpdateQuery', () => ({
  EmbeddedUpdateQuery: { viewPaginatedAsync: jest.fn() },
}));
jest.mock('../../../../graphql/queries/ChannelQuery', () => ({
  ChannelQuery: { viewUpdateChannelsOnAppAsync: jest.fn() },
}));
jest.mock('../../../../prompts');
jest.mock('../../../../log');
jest.mock('../../../../utils/json');

const mockPaginated = jest.mocked(EmbeddedUpdateQuery.viewPaginatedAsync);
const mockViewChannels = jest.mocked(ChannelQuery.viewUpdateChannelsOnAppAsync);
const mockSelectAsync = jest.mocked(selectAsync);
const mockLogLog = jest.mocked(Log.log);
const mockEnableJsonOutput = jest.mocked(json.enableJsonOutput);
const mockPrintJson = jest.mocked(json.printJsonOnlyOutput);

const MOCK_CONTEXT = {
  projectId: 'project-123',
  loggedIn: { graphqlClient: {} as ExpoGraphqlClient },
};

const ROW_A: EmbeddedUpdateFragment = {
  id: 'aaaaaaaa-1111-4000-8000-000000000001',
  platform: AppPlatform.Ios,
  runtimeVersion: '1.0.0',
  channel: 'production',
  createdAt: '2026-05-29T00:00:00Z',
  launchAsset: { id: 'asset-a', fileSize: 1024, finalFileSize: 768, fileSHA256: 'abc123' },
};
const ROW_B: EmbeddedUpdateFragment = {
  id: 'bbbbbbbb-2222-4000-8000-000000000002',
  platform: AppPlatform.Android,
  runtimeVersion: '1.0.1',
  channel: 'preview',
  createdAt: '2026-05-30T00:00:00Z',
  launchAsset: { id: 'asset-b', fileSize: 2048, finalFileSize: null, fileSHA256: 'def456' },
};

function emptyConnection(): {
  edges: { cursor: string; node: EmbeddedUpdateFragment }[];
  pageInfo: {
    hasNextPage: boolean;
    hasPreviousPage: boolean;
    startCursor: string | null;
    endCursor: string | null;
  };
} {
  return {
    edges: [],
    pageInfo: { hasNextPage: false, hasPreviousPage: false, startCursor: null, endCursor: null },
  };
}

describe(UpdateEmbeddedList, () => {
  const mockConfig = getMockOclifConfig();

  beforeEach(() => {
    jest.clearAllMocks();
    // Default: no channels on the project (skips the prompt).
    mockViewChannels.mockResolvedValue([]);
  });

  function createCommand(argv: string[]): UpdateEmbeddedList {
    const command = new UpdateEmbeddedList(argv, mockConfig);
    // @ts-expect-error getContextAsync is protected
    jest.spyOn(command, 'getContextAsync').mockResolvedValue(MOCK_CONTEXT);
    return command;
  }

  it('prints each row when results exist', async () => {
    mockPaginated.mockResolvedValue({
      edges: [
        { cursor: 'c1', node: ROW_A },
        { cursor: 'c2', node: ROW_B },
      ],
      pageInfo: { hasNextPage: false, hasPreviousPage: false, startCursor: 'c1', endCursor: 'c2' },
    });
    await createCommand(['--non-interactive']).run();

    expect(mockPaginated).toHaveBeenCalledWith(MOCK_CONTEXT.loggedIn.graphqlClient, {
      appId: MOCK_CONTEXT.projectId,
      filter: undefined,
      first: 25,
      after: undefined,
    });
    expect(mockLogLog.mock.calls.some(c => String(c[0]).includes(ROW_A.id))).toBe(true);
    expect(mockLogLog.mock.calls.some(c => String(c[0]).includes(ROW_B.id))).toBe(true);
  });

  it('prints empty message when no results', async () => {
    mockPaginated.mockResolvedValue(emptyConnection());
    await createCommand(['--non-interactive']).run();
    expect(mockLogLog).toHaveBeenCalledWith('No embedded updates found.');
  });

  it('--json prints connection payload and skips formatted output', async () => {
    mockPaginated.mockResolvedValue({
      edges: [{ cursor: 'c1', node: ROW_A }],
      pageInfo: { hasNextPage: false, hasPreviousPage: false, startCursor: 'c1', endCursor: 'c1' },
    });
    await createCommand(['--json', '--non-interactive']).run();

    expect(mockEnableJsonOutput).toHaveBeenCalled();
    expect(mockPrintJson).toHaveBeenCalledWith({
      embeddedUpdates: [ROW_A],
      pageInfo: { hasNextPage: false, hasPreviousPage: false, startCursor: 'c1', endCursor: 'c1' },
    });
    expect(mockLogLog.mock.calls.every(c => !String(c[0]).includes(ROW_A.id))).toBe(true);
  });

  it('passes filter when flags supplied', async () => {
    mockPaginated.mockResolvedValue(emptyConnection());
    await createCommand([
      '--non-interactive',
      '--platform',
      'ios',
      '--runtime-version',
      '1.2.0',
      '--channel',
      'preview',
    ]).run();

    expect(mockPaginated).toHaveBeenCalledWith(MOCK_CONTEXT.loggedIn.graphqlClient, {
      appId: MOCK_CONTEXT.projectId,
      filter: { platform: AppPlatform.Ios, runtimeVersion: '1.2.0', channel: 'preview' },
      first: 25,
      after: undefined,
    });
  });

  it('shows next-page hint when hasNextPage', async () => {
    mockPaginated.mockResolvedValue({
      edges: [{ cursor: 'c1', node: ROW_A }],
      pageInfo: { hasNextPage: true, hasPreviousPage: false, startCursor: 'c1', endCursor: 'c1' },
    });
    await createCommand(['--non-interactive']).run();

    expect(mockLogLog.mock.calls.some(c => String(c[0]).includes('--after-cursor c1'))).toBe(true);
  });

  it('prompts for channel in interactive mode and applies the selected channel', async () => {
    mockViewChannels.mockResolvedValue([
      { id: 'ch1', name: 'production' } as any,
      { id: 'ch2', name: 'preview' } as any,
    ]);
    mockSelectAsync.mockResolvedValue('preview');
    mockPaginated.mockResolvedValue(emptyConnection());

    await createCommand([]).run();

    expect(mockSelectAsync).toHaveBeenCalledTimes(1);
    expect(mockPaginated).toHaveBeenCalledWith(MOCK_CONTEXT.loggedIn.graphqlClient, {
      appId: MOCK_CONTEXT.projectId,
      filter: { platform: undefined, runtimeVersion: undefined, channel: 'preview' },
      first: 25,
      after: undefined,
    });
  });

  it('skips channel filter when "All channels" is selected', async () => {
    mockViewChannels.mockResolvedValue([{ id: 'ch1', name: 'production' } as any]);
    // The sentinel value returned by selectAsync for the "All channels" option.
    mockSelectAsync.mockResolvedValue('__embedded_update_list__all_channels__');
    mockPaginated.mockResolvedValue(emptyConnection());

    await createCommand([]).run();

    expect(mockPaginated).toHaveBeenCalledWith(MOCK_CONTEXT.loggedIn.graphqlClient, {
      appId: MOCK_CONTEXT.projectId,
      filter: undefined,
      first: 25,
      after: undefined,
    });
  });

  it('skips the channel prompt when --channel is supplied', async () => {
    mockPaginated.mockResolvedValue(emptyConnection());
    await createCommand(['--channel', 'preview']).run();
    expect(mockSelectAsync).not.toHaveBeenCalled();
    expect(mockViewChannels).not.toHaveBeenCalled();
  });

  it('treats --channel all as no channel filter', async () => {
    mockPaginated.mockResolvedValue(emptyConnection());
    await createCommand(['--channel', 'all']).run();
    expect(mockPaginated).toHaveBeenCalledWith(MOCK_CONTEXT.loggedIn.graphqlClient, {
      appId: MOCK_CONTEXT.projectId,
      filter: undefined,
      first: 25,
      after: undefined,
    });
  });

  it('skips the channel prompt when the project has no channels', async () => {
    mockViewChannels.mockResolvedValue([]);
    mockPaginated.mockResolvedValue(emptyConnection());
    await createCommand([]).run();
    expect(mockSelectAsync).not.toHaveBeenCalled();
  });

  it('passes --after-cursor through to viewPaginatedAsync', async () => {
    mockPaginated.mockResolvedValue(emptyConnection());
    await createCommand(['--non-interactive', '--after-cursor', 'cursor-123']).run();
    expect(mockPaginated).toHaveBeenCalledWith(MOCK_CONTEXT.loggedIn.graphqlClient, {
      appId: MOCK_CONTEXT.projectId,
      filter: undefined,
      first: 25,
      after: 'cursor-123',
    });
  });

  it('honors --limit', async () => {
    mockPaginated.mockResolvedValue(emptyConnection());
    await createCommand(['--non-interactive', '--limit', '5']).run();
    expect(mockPaginated).toHaveBeenCalledWith(
      MOCK_CONTEXT.loggedIn.graphqlClient,
      expect.objectContaining({ first: 5 })
    );
  });

  it('prints the section header with row count', async () => {
    mockPaginated.mockResolvedValue({
      edges: [{ cursor: 'c1', node: ROW_A }],
      pageInfo: { hasNextPage: false, hasPreviousPage: false, startCursor: 'c1', endCursor: 'c1' },
    });
    await createCommand(['--non-interactive']).run();
    expect(mockLogLog.mock.calls.some(c => String(c[0]).includes('Embedded updates (1)'))).toBe(
      true
    );
  });

  it('suffixes the section header count with "+" when hasNextPage', async () => {
    mockPaginated.mockResolvedValue({
      edges: [{ cursor: 'c1', node: ROW_A }],
      pageInfo: { hasNextPage: true, hasPreviousPage: false, startCursor: 'c1', endCursor: 'c1' },
    });
    await createCommand(['--non-interactive']).run();
    expect(mockLogLog.mock.calls.some(c => String(c[0]).includes('Embedded updates (1+)'))).toBe(
      true
    );
  });

  it('shows relative-time "ago" hints in formatted rows', async () => {
    mockPaginated.mockResolvedValue({
      edges: [{ cursor: 'c1', node: ROW_A }],
      pageInfo: { hasNextPage: false, hasPreviousPage: false, startCursor: 'c1', endCursor: 'c1' },
    });
    await createCommand(['--non-interactive']).run();
    expect(mockLogLog.mock.calls.some(c => /ago/.test(String(c[0])))).toBe(true);
  });

  it('puts "All channels" first in the prompt, then channels in order', async () => {
    mockViewChannels.mockResolvedValue([
      { id: 'ch1', name: 'production' } as any,
      { id: 'ch2', name: 'preview' } as any,
    ]);
    mockSelectAsync.mockResolvedValue('production');
    mockPaginated.mockResolvedValue(emptyConnection());

    await createCommand([]).run();

    const [, choices] = mockSelectAsync.mock.calls[0];
    const titles = (choices as any[]).map(c => c.title);
    expect(titles).toEqual(['All channels', 'production', 'preview']);
  });
});
