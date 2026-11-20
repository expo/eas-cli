import { vol } from 'memfs';

import { resolveProjectFilePathAsync } from '../projectFile';

const repositoryDirectory = '/repository';
const baseDirectory = '/repository/apps/mobile';
const projectDirectory = '/repository/apps/mobile/ios';

function createDirectories(...names: string[]): void {
  vol.fromJSON(
    Object.fromEntries(names.map(name => [`${name}/placeholder`, ''])),
    projectDirectory
  );
}

async function resolveAsync(
  overrides: Partial<Parameters<typeof resolveProjectFilePathAsync>[0]> = {}
): Promise<string> {
  return await resolveProjectFilePathAsync({
    projectDirectory,
    baseDirectory,
    repositoryDirectory,
    ...overrides,
  });
}

afterEach(() => {
  vol.reset();
});

describe(resolveProjectFilePathAsync, () => {
  it('uses the only workspace, also when the directory has a project', async () => {
    createDirectories('App.xcworkspace', 'App.xcodeproj', 'Pods');

    await expect(resolveAsync()).resolves.toBe('/repository/apps/mobile/ios/App.xcworkspace');
  });

  it('uses the only project when the directory has no workspace', async () => {
    createDirectories('App.xcodeproj', 'Sources');

    await expect(resolveAsync()).resolves.toBe('/repository/apps/mobile/ios/App.xcodeproj');
  });

  it('fails with the candidates when the directory has several workspaces', async () => {
    createDirectories('B.xcworkspace', 'A.xcworkspace', 'App.xcodeproj');

    await expect(resolveAsync()).rejects.toMatchObject({
      errorCode: 'NATIVE_XCODE_AMBIGUOUS_PROJECT_FILE',
      message: expect.stringMatching(
        /2 "\.xcworkspace" entries in "\/apps\/mobile\/ios".*A\.xcworkspace, B\.xcworkspace.*"xcode_project_file"/
      ),
    });
  });

  it('fails with the candidates when the directory has several projects and no workspace', async () => {
    createDirectories('App.xcodeproj', 'Tools.xcodeproj');

    await expect(resolveAsync()).rejects.toMatchObject({
      errorCode: 'NATIVE_XCODE_AMBIGUOUS_PROJECT_FILE',
      message: expect.stringMatching(/2 "\.xcodeproj" entries.*App\.xcodeproj, Tools\.xcodeproj/),
    });
  });

  it('fails with the searched directory and both ways to write "project_directory" when the directory has no workspace and no project', async () => {
    createDirectories('Sources');

    await expect(resolveAsync()).rejects.toMatchObject({
      errorCode: 'NATIVE_XCODE_PROJECT_FILE_NOT_FOUND',
      message:
        'Found no ".xcworkspace" and no ".xcodeproj" in "/apps/mobile/ios" (a path from the repository root). "project_directory" is read from the app\'s base directory, which is "/apps/mobile". Set "project_directory" to a path relative to the base directory, or to a path from the repository root that starts with "/".',
    });
  });

  it('fails with the searched directory when the directory does not exist', async () => {
    createDirectories('App.xcodeproj');

    await expect(
      resolveAsync({ projectDirectory: '/repository/apps/mobile/apps/mobile/ios' })
    ).rejects.toMatchObject({
      errorCode: 'NATIVE_XCODE_PROJECT_FILE_NOT_FOUND',
      message: expect.stringMatching(
        /in "\/apps\/mobile\/apps\/mobile\/ios" \(a path from the repository root\), and that directory does not exist\. .*the app's base directory, which is "\/apps\/mobile"/
      ),
    });
  });

  it('names the repository root as "/"', async () => {
    vol.fromJSON({ 'README.md': '' }, repositoryDirectory);

    await expect(
      resolveAsync({ projectDirectory: repositoryDirectory, baseDirectory: repositoryDirectory })
    ).rejects.toMatchObject({
      message: expect.stringMatching(/in "\/" \(a path.*which is "\/"\./),
    });
  });

  it('uses the given project file, relative to the project directory', async () => {
    createDirectories('A.xcworkspace', 'B.xcworkspace', 'apps/App.xcodeproj');

    await expect(resolveAsync({ projectFile: 'apps/App.xcodeproj' })).resolves.toBe(
      '/repository/apps/mobile/ios/apps/App.xcodeproj'
    );
  });

  it('fails when the given project file is not a workspace or a project', async () => {
    createDirectories('App.xcodeproj');

    await expect(
      resolveAsync({ projectFile: 'App.xcodeproj/project.pbxproj' })
    ).rejects.toMatchObject({ errorCode: 'NATIVE_XCODE_INVALID_PROJECT_FILE' });
  });

  it('fails with the path and the directory it was read from when the given project file does not exist', async () => {
    createDirectories('App.xcodeproj');

    await expect(resolveAsync({ projectFile: 'App.xcworkspace' })).rejects.toMatchObject({
      errorCode: 'NATIVE_XCODE_PROJECT_FILE_NOT_FOUND',
      message: expect.stringMatching(
        /found nothing at "\/apps\/mobile\/ios\/App\.xcworkspace".*"project_directory", which is "\/apps\/mobile\/ios" in this build/
      ),
    });
  });
});
