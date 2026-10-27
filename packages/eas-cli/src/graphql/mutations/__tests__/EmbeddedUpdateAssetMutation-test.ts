import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import { EmbeddedUpdateAssetMutation } from '../EmbeddedUpdateAssetMutation';

function makeGraphqlClient(data: unknown): ExpoGraphqlClient {
  return {
    mutation: jest.fn().mockReturnValue({
      toPromise: jest.fn().mockResolvedValue({ data }),
    }),
  } as unknown as ExpoGraphqlClient;
}

describe('EmbeddedUpdateAssetMutation.getSignedUploadSpecAsync', () => {
  it('returns the upload spec from the GraphQL response', async () => {
    const expected = {
      storageKey: 'app-id/update-id',
      presignedUrl: 'https://storage.example.com/upload',
      fields: { key: 'value' },
    };
    const client = makeGraphqlClient({
      embeddedUpdateAsset: {
        getSignedEmbeddedUpdateAssetUploadSpecifications: expected,
      },
    });

    const result = await EmbeddedUpdateAssetMutation.getSignedUploadSpecAsync(client, {
      appId: 'app-id',
      embeddedUpdateId: 'update-id',
      contentType: 'application/javascript',
    });

    expect(result).toEqual(expected);
  });
});
