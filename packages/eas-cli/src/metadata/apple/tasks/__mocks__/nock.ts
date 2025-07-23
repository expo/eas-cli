import { getRequestClient } from '@expo/apple-utils';
import { getAdapter } from 'axios';
// Axios from apple-utils needs to be patched when we use Nock.
// Instead of the default adapter, we need to use `axios/lib/adapters/http`
// see: https://github.com/nock/nock#axios

export { default } from 'nock';
getRequestClient().defaults.adapter = getAdapter('http');
