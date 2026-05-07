import { AccountUploadSessionType } from '../graphql/generated';
import { UploadSessionMutation } from '../graphql/mutations/UploadSessionMutation';
import { uploadAccountScopedBufferToGCSAsync } from '../uploads';

jest.mock('../graphql/mutations/UploadSessionMutation');
jest.mock('../fetch', () => ({
  __esModule: true,
  default: jest.fn(),
}));

const mockFetch = jest.requireMock('../fetch').default as jest.MockedFunction<
  typeof import('../fetch').default
>;

const mockGraphqlClient = {} as any;
const MOCK_BUCKET_KEY = 'accounts/test/uploads/abc123.tar.gz';
const MOCK_SIGNED_URL = {
  url: 'https://storage.googleapis.com/bucket/abc123',
  headers: { 'x-goog-signature': 'sig' },
  bucketKey: MOCK_BUCKET_KEY,
};

beforeEach(() => {
  jest.clearAllMocks();
  jest
    .mocked(UploadSessionMutation.createAccountScopedUploadSessionAsync)
    .mockResolvedValue(MOCK_SIGNED_URL);
});

describe('uploadAccountScopedBufferToGCSAsync', () => {
  it('requests a signed URL with the correct type and accountId', async () => {
    mockFetch.mockResolvedValue({ ok: true } as any);

    await uploadAccountScopedBufferToGCSAsync(mockGraphqlClient, {
      type: AccountUploadSessionType.WorkflowsProjectSources,
      accountId: 'account-id-123',
      buffer: Buffer.from('hello'),
    });

    expect(UploadSessionMutation.createAccountScopedUploadSessionAsync).toHaveBeenCalledWith(
      mockGraphqlClient,
      {
        type: AccountUploadSessionType.WorkflowsProjectSources,
        accountID: 'account-id-123',
      }
    );
  });

  it('performs a PUT request to the signed URL with the buffer as the body', async () => {
    mockFetch.mockResolvedValue({ ok: true } as any);
    const buffer = Buffer.from('test content');

    await uploadAccountScopedBufferToGCSAsync(mockGraphqlClient, {
      type: AccountUploadSessionType.WorkflowsProjectSources,
      accountId: 'account-id-123',
      buffer,
    });

    expect(mockFetch).toHaveBeenCalledWith(
      MOCK_SIGNED_URL.url,
      expect.objectContaining({ method: 'PUT', body: buffer })
    );
  });

  it('forwards signed URL headers in the PUT request', async () => {
    mockFetch.mockResolvedValue({ ok: true } as any);

    await uploadAccountScopedBufferToGCSAsync(mockGraphqlClient, {
      type: AccountUploadSessionType.WorkflowsProjectSources,
      accountId: 'account-id-123',
      buffer: Buffer.from('x'),
    });

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({ 'x-goog-signature': 'sig' }),
      })
    );
  });

  it('returns the bucket key on success', async () => {
    mockFetch.mockResolvedValue({ ok: true } as any);

    const result = await uploadAccountScopedBufferToGCSAsync(mockGraphqlClient, {
      type: AccountUploadSessionType.WorkflowsProjectSources,
      accountId: 'account-id-123',
      buffer: Buffer.from('x'),
    });

    expect(result).toBe(MOCK_BUCKET_KEY);
  });

  it('throws when the PUT response is not ok', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 403, statusText: 'Forbidden' } as any);

    await expect(
      uploadAccountScopedBufferToGCSAsync(mockGraphqlClient, {
        type: AccountUploadSessionType.WorkflowsProjectSources,
        accountId: 'account-id-123',
        buffer: Buffer.from('x'),
      })
    ).rejects.toThrow('403');
  });
});
