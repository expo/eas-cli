import { ExpoConfig } from '@expo/config';
import fs from 'fs-extra';

import { getEASUpdateURL } from '../../../api';
import { AppFragment } from '../../../graphql/generated';
import { easCliVersion } from '../../../utils/easCli';
import {
  cleanAndPrefix,
  copyProjectTemplatesAsync,
  generateAppConfigAsync,
  generateEasConfigAsync,
  updatePackageJsonAsync,
  updateReadmeAsync,
} from '../projectFiles';

jest.mock('../../../api');
jest.mock('fs-extra');

describe('projectFiles', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    jest.mocked(fs.writeFile).mockImplementation(() => Promise.resolve());
    jest.mocked(fs.readJson).mockImplementation(() => Promise.resolve({}));
    jest.mocked(fs.writeJson).mockImplementation(() => Promise.resolve());
    jest.mocked(fs.copy).mockImplementation(() => Promise.resolve());
    jest.mocked(fs.remove).mockImplementation(() => Promise.resolve());
    jest.mocked(fs.readFile).mockImplementation(() => Promise.resolve(''));
    jest.mocked(fs.symlink).mockImplementation(() => Promise.resolve());
  });

  describe('cleanAndPrefix', () => {
    it('should clean and prefix the string', () => {
      expect(cleanAndPrefix('test-app-123', 'app')).toBe('testapp123');
      expect(cleanAndPrefix('test@app#with$symbols', 'app')).toBe('testappwithsymbols');
      expect(cleanAndPrefix('test-app-with-dashes', 'app')).toBe('testappwithdashes');
      expect(cleanAndPrefix('TestApp', 'app')).toBe('appTestApp');
      expect(cleanAndPrefix('100 App', 'app')).toBe('app100App');
    });

    it('should handle schemes', () => {
      expect(cleanAndPrefix('test-app-123', 'scheme')).toBe('test-app-123');
      expect(cleanAndPrefix('test@app#with$symbols', 'scheme')).toBe('testappwithsymbols');
      expect(cleanAndPrefix('test+app.with-allowed.symbols', 'scheme')).toBe(
        'test+app.with-allowed.symbols'
      );
      expect(cleanAndPrefix('100 App', 'scheme')).toBe('scheme100app');
      expect(cleanAndPrefix('TestApp', 'scheme')).toBe('testapp');
      expect(cleanAndPrefix('testApp2', 'scheme')).toBe('testapp2');
    });
  });

  describe('generateAppConfigAsync', () => {
    const projectDir = '/test/project-dir';
    const mockUpdateUrl = 'https://u.expo.dev/test-project-id';

    const createMockApp = (overrides: Partial<AppFragment> = {}): AppFragment => ({
      id: 'test-project-id',
      name: 'Test App',
      fullName: '@testowner/test-app',
      slug: 'test-app',
      ownerAccount: {
        id: 'testowner-account-id',
        name: 'testowner',
        users: [],
      },
      ...overrides,
    });

    beforeEach(() => {
      jest.mocked(getEASUpdateURL).mockReturnValue(mockUpdateUrl);
      jest.mocked(fs.readJson).mockResolvedValue({
        expo: {} as ExpoConfig,
      });
    });

    it('should generate the app config', async () => {
      const mockApp = createMockApp();
      jest.mocked(fs.readJson).mockResolvedValue({
        expo: {
          name: 'value-to-override',
          slug: 'value-to-override',
          icon: 'value-to-keep',
        } as ExpoConfig,
      });

      await generateAppConfigAsync(projectDir, mockApp);

      expect(getEASUpdateURL).toHaveBeenCalledWith('test-project-id', null);

      const expectedConfig = {
        expo: {
          name: 'Test App',
          slug: 'test-app',
          scheme: 'testapp',
          icon: 'value-to-keep',
          extra: {
            eas: {
              projectId: 'test-project-id',
            },
          },
          owner: 'testowner',
          updates: {
            url: mockUpdateUrl,
          },
          runtimeVersion: {
            policy: 'appVersion',
          },
          ios: {
            bundleIdentifier: 'com.testowner.testapp',
          },
          android: {
            package: 'com.testowner.testapp',
          },
        },
      };

      expect(fs.writeJson).toHaveBeenCalledWith(`${projectDir}/app.json`, expectedConfig, {
        spaces: 2,
      });
    });

    it('should handle invalid characters in the bundle identifier', async () => {
      const mockApp = createMockApp({
        slug: 'test-app-with-dashes',
        ownerAccount: {
          id: 'test-owner-account-id',
          name: 'test-owner',
          users: [],
        },
      });

      await generateAppConfigAsync(projectDir, mockApp);

      expect(fs.writeJson).toHaveBeenCalledWith(
        `${projectDir}/app.json`,
        expect.objectContaining({
          expo: expect.objectContaining({
            ios: expect.objectContaining({
              bundleIdentifier: 'com.testowner.testappwithdashes',
            }),
          }),
        }),
        { spaces: 2 }
      );
    });

    it('should handle invalid characters in the owner account name', async () => {
      const mockApp = createMockApp({
        slug: 'testapp',
        ownerAccount: {
          id: 'test-owner-123-account-id',
          name: 'test-owner-123',
          users: [],
        },
      });

      await generateAppConfigAsync(projectDir, mockApp);

      expect(fs.writeJson).toHaveBeenCalledWith(
        `${projectDir}/app.json`,
        expect.objectContaining({
          expo: expect.objectContaining({
            ios: expect.objectContaining({
              bundleIdentifier: 'com.testowner123.testapp',
            }),
          }),
        }),
        { spaces: 2 }
      );
    });

    it('should handle invalid characters in the slug', async () => {
      const mockApp = createMockApp({
        slug: 'test@app#with$symbols',
        fullName: '@testowner/test@app#with$symbols',
      });

      await generateAppConfigAsync(projectDir, mockApp);

      expect(fs.writeJson).toHaveBeenCalledWith(
        `${projectDir}/app.json`,
        expect.objectContaining({
          expo: expect.objectContaining({
            ios: expect.objectContaining({
              bundleIdentifier: 'com.testowner.testappwithsymbols',
            }),
          }),
        }),
        { spaces: 2 }
      );
    });
  });

  describe('generateEasConfigAsync', () => {
    const projectDir = '/test/project-dir';

    it('should generate the eas config', async () => {
      const expectedEasConfig = {
        cli: {
          version: `>= ${easCliVersion}`,
          appVersionSource: 'remote',
        },
        build: {
          development: {
            developmentClient: true,
            distribution: 'internal',
            android: { image: 'latest' },
            ios: { image: 'latest' },
          },
          'development-simulator': {
            extends: 'development',
            ios: { simulator: true },
          },
          preview: {
            distribution: 'internal',
            channel: 'main',
            android: { image: 'latest' },
            ios: { image: 'latest' },
          },
          production: {
            channel: 'production',
            autoIncrement: true,
            android: { image: 'latest' },
            ios: { image: 'latest' },
          },
        },
        submit: {
          production: {},
        },
      };

      await generateEasConfigAsync(projectDir);

      expect(fs.writeJson).toHaveBeenCalledWith(`${projectDir}/eas.json`, expectedEasConfig, {
        spaces: 2,
      });
    });
  });

  describe('updatePackageJsonAsync', () => {
    it('should update the package.json', async () => {
      jest.mocked(fs.readJson).mockResolvedValue({
        name: 'test-app',
        version: '1.0.0',
      });
      const projectDir = '/test/project-dir';
      await updatePackageJsonAsync(projectDir);

      const expectedPackageJson = {
        name: 'test-app',
        version: '1.0.0',
        scripts: {
          draft: 'npx eas-cli@latest workflow:run create-draft.yml',
          'development-builds': 'npx eas-cli@latest workflow:run create-development-builds.yml',
          deploy: 'npx eas-cli@latest workflow:run deploy-to-production.yml',
        },
      };

      expect(fs.writeJson).toHaveBeenCalledWith(`${projectDir}/package.json`, expectedPackageJson, {
        spaces: 2,
      });
    });
  });

  describe('copyProjectTemplatesAsync', () => {
    it('should copy the project templates', async () => {
      const projectDir = '/test/project-dir';

      await copyProjectTemplatesAsync(projectDir);

      expect(fs.copy).toHaveBeenCalledWith(
        expect.stringContaining('templates'),
        projectDir,
        expect.objectContaining({
          errorOnExist: false,
          overwrite: true,
          filter: expect.any(Function),
        })
      );
    });
  });

  describe('updateReadmeAsync', () => {
    const projectDir = '/test/project-dir';
    const readmeTemplatePath = expect.stringContaining('templates/readme-additions.md');
    const projectReadmePath = `${projectDir}/README.md`;

    const mockReadmeTemplate = `## Get started

To start the app, in your terminal run:

\`\`\`bash
npm run start
\`\`\`

## Workflows
`;
    const mockExistingReadme = `# My App

## Get started

Follow these steps to get started with the app.

## Installation

Install the dependencies first.`;

    beforeEach(() => {
      jest.mocked(fs.readFile).mockImplementation((filePath: any) => {
        const content = filePath.includes('readme-additions.md')
          ? mockReadmeTemplate
          : filePath === projectReadmePath
            ? mockExistingReadme
            : '';
        return Promise.resolve(content);
      });
    });

    it('should read the existing readme and merge the template content', async () => {
      await updateReadmeAsync(projectDir, 'npm');

      expect(fs.readFile).toHaveBeenCalledWith(readmeTemplatePath, 'utf8');
      expect(fs.readFile).toHaveBeenCalledWith(projectReadmePath, 'utf8');

      const headings = ['# My App', '## Get started', '## Workflows'];
      expect(fs.writeFile).toHaveBeenCalledWith(
        projectReadmePath,
        expect.stringMatching(new RegExp(headings.join('[\\s\\S]*')))
      );
    });

    it('should replace npm run with package manager specific commands', async () => {
      await updateReadmeAsync(projectDir, 'yarn');

      expect(fs.writeFile).toHaveBeenCalledWith(
        projectReadmePath,
        expect.stringContaining('yarn run start')
      );
    });

    it("should handle the case when 'Get started' section does not exist", async () => {
      const readmeWithoutGetStarted = `# My App

This is my awesome app.

## Installation

Install the dependencies first.`;

      jest.mocked(fs.readFile).mockImplementation((filePath: any) => {
        const content = filePath.includes('readme-additions.md')
          ? mockReadmeTemplate
          : filePath === projectReadmePath
            ? readmeWithoutGetStarted
            : '';
        return Promise.resolve(content);
      });

      await updateReadmeAsync(projectDir, 'npm');

      const headings = ['# My App', '## Installation', '## Get started', '## Workflows'];
      expect(fs.writeFile).toHaveBeenCalledWith(
        projectReadmePath,
        expect.stringMatching(new RegExp(headings.join('[\\s\\S]*')))
      );
    });
  });
});
