if (process.env.NODE_ENV !== 'test') {
  throw new Error("NODE_ENV environment variable must be set to 'test'.");
}

process.env.ENVIRONMENT = 'test';
process.env.LOGGER_LEVEL = 'debug';
process.env.WORKER_RUNTIME_CONFIG_BASE64 = 'eyAiaW1hZ2UiOiAiIiB9'; // { "image": "" }
// eslint-disable-next-line no-underscore-dangle
process.env.__API_SERVER_URL = 'http://api.expo.test';
process.env.PORT = '3015';

// Always mock:
jest.mock('@expo/build-tools', () => {
  return {
    ...jest.requireActual('@expo/build-tools'),
    GCS: {
      uploadWithSignedUrl: jest.fn(),
    },
  };
});
