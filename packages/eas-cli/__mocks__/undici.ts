const undici = require('undici');

// This workaround swaps `undici.fetch` for `global.fetch` to connect Nock with Undici.
// See: https://github.com/nock/nock/issues/2183
require('nock');

module.exports = { ...undici, fetch: global.fetch };
