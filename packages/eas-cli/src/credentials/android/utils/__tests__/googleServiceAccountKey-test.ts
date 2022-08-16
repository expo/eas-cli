import { vol } from 'memfs';

import { confirmAsync, promptAsync } from '../../../../prompts';
import { detectGoogleServiceAccountKeyPathAsync } from '../googleServiceAccountKey';

jest.mock('fs');
jest.mock('../../../../prompts');

beforeAll(() => {
  const mockDetectableServiceAccountJson = JSON.stringify({
    type: 'service_account',
    private_key: 'super secret',
    client_email: 'beep-boop@iam.gserviceaccount.com',
  });

  vol.fromJSON({
    '/project_dir/subdir/service-account.json': mockDetectableServiceAccountJson,
    '/project_dir/another-service-account.json': mockDetectableServiceAccountJson,
    '/other_dir/invalid_file.txt': 'this is not even a JSON',
  });
});
afterAll(() => {
  vol.reset();
});

afterEach(() => {
  jest.mocked(promptAsync).mockClear();
  jest.mocked(confirmAsync).mockClear();
});

describe('Google Service Account Key path detection', () => {
  it('detects a single google-services file and prompts for confirmation', async () => {
    jest.mocked(confirmAsync).mockResolvedValueOnce(true);
    const serviceAccountPath = await detectGoogleServiceAccountKeyPathAsync('/project_dir/subdir');
    expect(confirmAsync).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Would you like to use this file?' })
    );
    expect(serviceAccountPath).toBe('/project_dir/subdir/service-account.json');
  });

  it('returns null, when no valid files are found in the dir', async () => {
    const serviceAccountPath = await detectGoogleServiceAccountKeyPathAsync('/other_dir'); // no valid files in that dir
    expect(promptAsync).not.toHaveBeenCalled();
    expect(serviceAccountPath).toBe(null);
  });

  it('returns null, when user rejects to use detected file', async () => {
    jest.mocked(confirmAsync).mockResolvedValueOnce(false);
    const serviceAccountPath = await detectGoogleServiceAccountKeyPathAsync('/project_dir/subdir');
    expect(confirmAsync).toHaveBeenCalledTimes(1);
    expect(confirmAsync).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Would you like to use this file?' })
    );
    expect(serviceAccountPath).toBe(null);
  });

  it('displays a chooser, when multiple files are found', async () => {
    jest.mocked(promptAsync).mockResolvedValueOnce({
      selectedPath: '/project_dir/another-service-account.json',
    });
    const serviceAccountPath = await detectGoogleServiceAccountKeyPathAsync('/project_dir'); // should find 2 files here

    const expectedChoices = expect.arrayContaining([
      expect.objectContaining({ value: '/project_dir/another-service-account.json' }),
      expect.objectContaining({ value: '/project_dir/subdir/service-account.json' }),
      expect.objectContaining({ value: null }),
    ]);
    expect(promptAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'select',
        choices: expectedChoices,
      })
    );
    expect(serviceAccountPath).toBe('/project_dir/another-service-account.json');
  });

  it('returns null, when user selects the "None of above"', async () => {
    jest.mocked(promptAsync).mockResolvedValueOnce({
      selectedPath: false,
    });

    const serviceAccountPath = await detectGoogleServiceAccountKeyPathAsync('/project_dir'); // should find 2 files here

    expect(promptAsync).toHaveBeenCalledTimes(1);
    expect(promptAsync).toHaveBeenCalledWith(expect.objectContaining({ type: 'select' }));
    expect(serviceAccountPath).toBe(null);
  });
});
