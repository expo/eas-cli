import { Platform, Workflow } from '@expo/eas-build-job';
import { vol } from 'memfs';

import { resolveWorkflow } from '../workflow';

jest.mock('fs');

const originalConsoleWarn = console.warn;
beforeAll(() => {
  console.warn = jest.fn();
});
afterAll(() => {
  console.warn = originalConsoleWarn;
});

describe(resolveWorkflow, () => {
  beforeEach(() => {
    vol.reset();
  });

  const projectDir = '/app';

  test('generic workflow for both platforms', async () => {
    vol.fromJSON(
      {
        './ios/helloworld.xcodeproj/project.pbxproj': 'fake',
        './android/app/src/main/AndroidManifest.xml': 'fake',
      },
      projectDir
    );

    await expect(resolveWorkflow(projectDir, Platform.ANDROID)).resolves.toBe(Workflow.GENERIC);
    await expect(resolveWorkflow(projectDir, Platform.IOS)).resolves.toBe(Workflow.GENERIC);
  });

  test('generic workflow for single platform', async () => {
    vol.fromJSON(
      {
        './ios/helloworld.xcodeproj/project.pbxproj': 'fake',
      },
      projectDir
    );

    await expect(resolveWorkflow(projectDir, Platform.ANDROID)).resolves.toBe(Workflow.MANAGED);
    await expect(resolveWorkflow(projectDir, Platform.IOS)).resolves.toBe(Workflow.GENERIC);
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

    await expect(resolveWorkflow(projectDir, Platform.ANDROID)).resolves.toBe(Workflow.MANAGED);
    await expect(resolveWorkflow(projectDir, Platform.IOS)).resolves.toBe(Workflow.MANAGED);
  });
});
