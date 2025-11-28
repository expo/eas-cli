import logger from '../src/logger';

if (process.env.NODE_ENV !== 'test') {
  throw new Error("NODE_ENV environment variable must be set to 'test'.");
}

if (!process.env.LISTENING_TO_UNHANDLED_REJECTION) {
  process.on('unhandledRejection', (reason) => {
    logger.error('UNHANDLED PROMISE REJECTION', reason);
  });
  // Avoid memory leak by adding too many listeners
  process.env.LISTENING_TO_UNHANDLED_REJECTION = 'true';
}

// Always mock:
jest.mock('@google-cloud/kms', () => {});
jest.mock('../src/CacheManager');
