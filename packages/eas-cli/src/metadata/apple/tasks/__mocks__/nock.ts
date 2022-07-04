import AppleUtils from '@expo/apple-utils';

export { default } from 'nock';

const { getRequestClient } = AppleUtils;

// Axios from apple-utils needs to be patched when we use Nock.
// Instead of the default adapter, we need to use `axios/lib/adapters/http`
// see: https://github.com/nock/nock#axios
getRequestClient().defaults.adapter = require('axios/lib/adapters/http');
