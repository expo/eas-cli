import {
  DynamicPrivateProjectConfigContextField,
  DynamicPublicProjectConfigContextField,
} from '../DynamicProjectConfigContextField';
import { findProjectDirAndVerifyProjectSetupAsync } from '../contextUtils/findProjectDirAndVerifyProjectSetupAsync';
import { getProjectIdAsync } from '../contextUtils/getProjectIdAsync';
import { getPrivateExpoConfigAsync, getPublicExpoConfigAsync } from '../../../project/expoConfig';

jest.mock('../contextUtils/findProjectDirAndVerifyProjectSetupAsync');
jest.mock('../contextUtils/getProjectIdAsync');
jest.mock('../../../project/expoConfig');

describe('dynamic project config context fields', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it.each([
    ['public config', DynamicPublicProjectConfigContextField, getPublicExpoConfigAsync],
    ['private config', DynamicPrivateProjectConfigContextField, getPrivateExpoConfigAsync],
  ])(
    "uses the caller's env and mode for %s",
    async (_description, ContextField, getExpoConfigAsync) => {
      jest.mocked(findProjectDirAndVerifyProjectSetupAsync).mockResolvedValue('/app');
      jest.mocked(getExpoConfigAsync).mockResolvedValue({ name: 'app', slug: 'app' });
      jest.mocked(getProjectIdAsync).mockResolvedValue('project-id');

      const getProjectConfigAsync = await new ContextField().getValueAsync({
        analytics: {} as any,
        nonInteractive: true,
        sessionManager: {} as any,
      });
      const options = {
        env: { APP_VARIANT: 'preview' },
        mode: 'production' as const,
      };

      await getProjectConfigAsync(options);

      expect(getExpoConfigAsync).toHaveBeenNthCalledWith(1, '/app', options);
      expect(getExpoConfigAsync).toHaveBeenNthCalledWith(2, '/app', options);
      expect(getProjectIdAsync).toHaveBeenCalledWith(
        expect.anything(),
        { name: 'app', slug: 'app' },
        {
          ...options,
          nonInteractive: true,
        }
      );
    }
  );
});
