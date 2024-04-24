import { testAppJson } from '../../credentials/__tests__/fixtures-constants';
import { EASUpdateContext } from '../utils';

export function createCtxMock(options: { nonInteractive?: boolean } = {}): EASUpdateContext {
  return {
    graphqlClient: jest.fn() as any,
    nonInteractive: options.nonInteractive ?? false,
    app: { exp: testAppJson, projectId: 'test-project-id', projectDir: '/' },
    vcsClient: jest.fn() as any,
  };
}
