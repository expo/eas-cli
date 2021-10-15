import { Platform, Workflow } from '@expo/eas-build-job';
import { vol } from 'memfs';

import { resolveWorkflowAsync } from '../workflow';

jest.mock('fs');

describe(resolveWorkflowAsync, () => {
  beforeEach(() => {
    vol.reset();
  });

  const projectDir = '/app';

  test('bare workflow for both platforms', async () => {
    vol.fromJSON(
      {
        './ios/helloworld.xcodeproj/project.pbxproj': 'fake',
        './android/app/src/main/AndroidManifest.xml': 'fake',
      },
      projectDir
    );

    await expect(resolveWorkflowAsync(projectDir, Platform.ANDROID)).resolves.toBe(
      Workflow.GENERIC
    );
    await expect(resolveWorkflowAsync(projectDir, Platform.IOS)).resolves.toBe(Workflow.GENERIC);
  });

  test('bare workflow for single platform', async () => {
    vol.fromJSON(
      {
        './ios/helloworld.xcodeproj/project.pbxproj': 'fake',
      },
      projectDir
    );

    await expect(resolveWorkflowAsync(projectDir, Platform.ANDROID)).resolves.toBe(
      Workflow.MANAGED
    );
    await expect(resolveWorkflowAsync(projectDir, Platform.IOS)).resolves.toBe(Workflow.GENERIC);
  });

  test('android/ios directories are ignored', async () => {
    vol.fromJSON(
      {
        './ios/helloworld.xcodeproj/project.pbxproj': 'fake',
        './android/app/src/main/AndroidManifest.xml': 'fake',
        './.easignore': 'android/\nios/',
      },
      projectDir
    );

    await expect(resolveWorkflowAsync(projectDir, Platform.ANDROID)).resolves.toBe(
      Workflow.MANAGED
    );
    await expect(resolveWorkflowAsync(projectDir, Platform.IOS)).resolves.toBe(Workflow.MANAGED);
  });
});
