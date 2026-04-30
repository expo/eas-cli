import { ExpoConfig } from '@expo/config';
import { Android } from '@expo/eas-build-job';
import spawn from '@expo/turtle-spawn';
import fs from 'fs-extra';
import { vol } from 'memfs';
import path from 'path';
import { Readable } from 'stream';
import { instance, mock, when } from 'ts-mockito';

import { BuildContext } from '../../context';
import { PackageManager, findPackagerRootDir } from '../packageManager';
import {
  isUsingModernYarnVersion,
  readAndLogPackageJson,
  readEasJsonContents,
  runExpoCliCommand,
} from '../project';

jest.mock('fs');
jest.mock('@expo/turtle-spawn', () => ({
  __esModule: true,
  default: jest.fn(),
}));
jest.mock('../packageManager', () => ({
  ...jest.requireActual('../packageManager'),
  findPackagerRootDir: jest.fn((dir: string) => dir),
}));

describe(runExpoCliCommand, () => {
  describe('Expo SDK >= 46', () => {
    it('spawns expo via "npx" when package manager is npm', () => {
      const mockExpoConfig = mock<ExpoConfig>();
      when(mockExpoConfig.sdkVersion).thenReturn('46.0.0');
      const expoConfig = instance(mockExpoConfig);

      const mockCtx = mock<BuildContext<Android.Job>>();
      when(mockCtx.packageManager).thenReturn(PackageManager.NPM);
      when(mockCtx.appConfig).thenReturn(Promise.resolve(expoConfig));
      const ctx = instance(mockCtx);

      void runExpoCliCommand({ args: ['doctor'], options: {}, packageManager: ctx.packageManager });
      expect(spawn).toHaveBeenCalledWith('npx', ['expo', 'doctor'], expect.any(Object));
    });

    it('spawns expo via "yarn" when package manager is yarn', () => {
      const mockExpoConfig = mock<ExpoConfig>();
      when(mockExpoConfig.sdkVersion).thenReturn('46.0.0');
      const expoConfig = instance(mockExpoConfig);

      const mockCtx = mock<BuildContext<Android.Job>>();
      when(mockCtx.packageManager).thenReturn(PackageManager.NPM);
      when(mockCtx.appConfig).thenReturn(Promise.resolve(expoConfig));
      const ctx = instance(mockCtx);

      void runExpoCliCommand({ args: ['doctor'], options: {}, packageManager: ctx.packageManager });
      expect(spawn).toHaveBeenCalledWith('npx', ['expo', 'doctor'], expect.any(Object));
    });

    it('spawns expo via "pnpm" when package manager is pnpm', () => {
      const mockExpoConfig = mock<ExpoConfig>();
      when(mockExpoConfig.sdkVersion).thenReturn('46.0.0');
      const expoConfig = instance(mockExpoConfig);

      const mockCtx = mock<BuildContext<Android.Job>>();
      when(mockCtx.packageManager).thenReturn(PackageManager.PNPM);
      when(mockCtx.appConfig).thenReturn(Promise.resolve(expoConfig));
      const ctx = instance(mockCtx);

      void runExpoCliCommand({ args: ['doctor'], options: {}, packageManager: ctx.packageManager });
      expect(spawn).toHaveBeenCalledWith('pnpm', ['expo', 'doctor'], expect.any(Object));
    });

    it('spawns expo via "bun" when package manager is bun', () => {
      const mockExpoConfig = mock<ExpoConfig>();
      when(mockExpoConfig.sdkVersion).thenReturn('46.0.0');
      const expoConfig = instance(mockExpoConfig);

      const mockCtx = mock<BuildContext<Android.Job>>();
      when(mockCtx.packageManager).thenReturn(PackageManager.BUN);
      when(mockCtx.appConfig).thenReturn(Promise.resolve(expoConfig));
      const ctx = instance(mockCtx);

      void runExpoCliCommand({ args: ['doctor'], options: {}, packageManager: ctx.packageManager });
      expect(spawn).toHaveBeenCalledWith('bun', ['expo', 'doctor'], expect.any(Object));
    });
  });
});

describe(isUsingModernYarnVersion, () => {
  const projectDir = '/project';
  const mockedFindPackagerRootDir = findPackagerRootDir as jest.MockedFunction<
    typeof findPackagerRootDir
  >;

  beforeEach(() => {
    mockedFindPackagerRootDir.mockReturnValue(projectDir);
    jest.spyOn(fs, 'createReadStream').mockImplementation(((
      filePath: string,
      options?: { start?: number; end?: number }
    ) => {
      const content = fs.readFileSync(filePath, 'utf8');
      const start = options?.start ?? 0;
      const end = options?.end != null ? options.end + 1 : content.length;
      return Readable.from(Buffer.from(content.slice(start, end)));
    }) as any);
  });

  it('returns true when .yarnrc.yml exists in project directory', async () => {
    vol.fromJSON({ [path.join(projectDir, '.yarnrc.yml')]: '' });
    expect(await isUsingModernYarnVersion(projectDir)).toBe(true);
  });

  it('returns true when .yarnrc.yml exists in workspace root directory', async () => {
    const workspaceRoot = '/workspace-root';
    mockedFindPackagerRootDir.mockReturnValue(workspaceRoot);
    vol.fromJSON({ [path.join(workspaceRoot, '.yarnrc.yml')]: '' });
    expect(await isUsingModernYarnVersion(projectDir)).toBe(true);
  });

  it('returns false when no .yarnrc.yml and no yarn.lock exist', async () => {
    vol.fromJSON({ [projectDir]: null });
    expect(await isUsingModernYarnVersion(projectDir)).toBe(false);
  });

  it('returns false when yarn.lock contains classic v1 header', async () => {
    vol.fromJSON({ [path.join(projectDir, 'yarn.lock')]: '# yarn lockfile v1\n' });
    expect(await isUsingModernYarnVersion(projectDir)).toBe(false);
  });

  it('returns true when yarn.lock does not contain classic v1 header', async () => {
    vol.fromJSON({ [path.join(projectDir, 'yarn.lock')]: '__metadata:\n  version: 8\n' });
    expect(await isUsingModernYarnVersion(projectDir)).toBe(true);
  });

  it('returns true when .yarnrc.yml exists even with classic yarn.lock', async () => {
    vol.fromJSON({
      [path.join(projectDir, '.yarnrc.yml')]: '',
      [path.join(projectDir, 'yarn.lock')]: '# yarn lockfile v1\n',
    });
    expect(await isUsingModernYarnVersion(projectDir)).toBe(true);
  });
});

describe(readEasJsonContents, () => {
  it('returns the raw eas.json contents even when it is not valid JSON', async () => {
    const projectDir = '/project';
    const easJsonPath = path.join(projectDir, 'eas.json');
    const contents = "{\n  build: {\n    ios: {\n      image: 'latest'\n    }\n  }\n}\n";

    await fs.mkdirp(projectDir);
    await fs.writeFile(easJsonPath, contents);

    expect(readEasJsonContents(projectDir)).toBe(contents);
  });
});

describe(readAndLogPackageJson, () => {
  beforeEach(() => {
    vol.reset();
  });

  it('reads package.json, logs it, and returns parsed contents', async () => {
    const projectDir = '/project';
    const packageJsonPath = path.join(projectDir, 'package.json');
    const packageJson = { name: 'app', version: '1.0.0' };
    const logger = { info: jest.fn() };

    await fs.mkdirp(projectDir);
    await fs.writeJson(packageJsonPath, packageJson);

    expect(readAndLogPackageJson(logger, projectDir)).toEqual(packageJson);
    expect(logger.info).toHaveBeenNthCalledWith(1, 'Using package.json:');
    expect(logger.info).toHaveBeenNthCalledWith(2, JSON.stringify(packageJson, null, 2));
  });
});
