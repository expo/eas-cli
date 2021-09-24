import assert from 'assert';

import { GoogleServiceAccountKey } from '../credentials';

export function validateServiceAccountKey(keyJson: string): GoogleServiceAccountKey {
  const jsonKeyObject = JSON.parse(keyJson);
  assert(
    'private_key' in jsonKeyObject && typeof jsonKeyObject['private_key'] === 'string',
    'The provided JSON key file must contain the "private_key" field'
  );
  return jsonKeyObject;
}
