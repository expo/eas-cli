if (process.env.NODE_ENV !== 'test') {
  throw new Error("NODE_ENV environment variable must be set to 'test'.");
}

// Always mock:
jest.mock('@google-cloud/kms', () => {});
