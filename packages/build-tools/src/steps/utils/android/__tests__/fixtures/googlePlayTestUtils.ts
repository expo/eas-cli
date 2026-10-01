import nock from 'nock';
import { generateKeyPairSync } from 'node:crypto';

import { packageName } from '../../../../functions/__tests__/fixtures/androidTestUtils';

export { packageName };

export const editPath = `/androidpublisher/v3/applications/${packageName}/edits/edit`;
export const serviceAccount = {
  type: 'service_account', client_email: 'submit@example.iam.gserviceaccount.com', private_key_id: 'test-key',
  private_key: generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
};
export const api = (): nock.Scope => nock('https://androidpublisher.googleapis.com', {
  reqheaders: { authorization: 'Bearer test-access-token' },
});
export function mockToken(times = 1): nock.Scope {
  return nock('https://oauth2.googleapis.com').post('/token').times(times).reply(200, {
    access_token: 'test-access-token', expires_in: 3600, token_type: 'Bearer',
  });
}
