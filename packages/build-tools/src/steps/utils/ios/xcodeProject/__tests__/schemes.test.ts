import { vol } from 'memfs';

import { createMockLogger } from '../../../../../__tests__/utils/logger';
import { XcodeScheme, findSharedSchemesAsync, readSchemeAsync, selectScheme } from '../schemes';

function createSchemeXml({
  buildables,
  archiveConfiguration = 'Release',
  launchConfiguration = 'Debug',
}: {
  buildables: { name: string; product: string; id: string; container: string }[];
  archiveConfiguration?: string;
  launchConfiguration?: string;
}): string {
  const entries = buildables
    .map(
      ({ name, product, id, container }) => `
      <BuildActionEntry buildForArchiving = "YES">
        <BuildableReference
          BuildableIdentifier = "primary"
          BlueprintIdentifier = "${id}"
          BuildableName = "${product}"
          BlueprintName = "${name}"
          ReferencedContainer = "container:${container}">
        </BuildableReference>
      </BuildActionEntry>`
    )
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<Scheme LastUpgradeVersion = "1600" version = "1.3">
  <BuildAction parallelizeBuildables = "YES">
    <BuildActionEntries>${entries}
    </BuildActionEntries>
  </BuildAction>
  <LaunchAction buildConfiguration = "${launchConfiguration}"></LaunchAction>
  <ArchiveAction buildConfiguration = "${archiveConfiguration}" revealArchiveInOrganizer = "YES"></ArchiveAction>
</Scheme>`;
}

function createScheme(name: string): XcodeScheme {
  return {
    name,
    path: `/project/App.xcodeproj/xcshareddata/xcschemes/${name}.xcscheme`,
    containerPathBase: '/project',
  };
}

afterEach(() => {
  vol.reset();
});

describe(findSharedSchemesAsync, () => {
  it('lists the shared schemes of a project', async () => {
    vol.fromJSON({
      '/project/App.xcodeproj/xcshareddata/xcschemes/App.xcscheme': '',
      '/project/App.xcodeproj/xcshareddata/xcschemes/App Staging.xcscheme': '',
      '/project/App.xcodeproj/xcshareddata/xcschemes/xcschememanagement.plist': '',
      '/project/App.xcodeproj/xcuserdata/user.xcuserdatad/xcschemes/Private.xcscheme': '',
    });

    const schemes = await findSharedSchemesAsync('/project/App.xcodeproj');

    expect(schemes).toEqual(
      expect.arrayContaining([createScheme('App'), createScheme('App Staging')])
    );
    expect(schemes).toHaveLength(2);
  });

  it('returns no scheme when the project has no shared scheme', async () => {
    vol.fromJSON({ '/project/App.xcodeproj/project.pbxproj': '' });

    await expect(findSharedSchemesAsync('/project/App.xcodeproj')).resolves.toEqual([]);
  });

  it('lists the shared schemes of a workspace and of the projects it references', async () => {
    vol.fromJSON({
      '/project/App.xcworkspace/contents.xcworkspacedata': `<?xml version="1.0" encoding="UTF-8"?>
<Workspace version = "1.0">
  <FileRef location = "group:App.xcodeproj"></FileRef>
  <FileRef location = "group:README.md"></FileRef>
  <FileRef location = "group:Modules/Core/Core.xcodeproj"></FileRef>
  <FileRef location = "container:Tools/Tools.xcodeproj"></FileRef>
</Workspace>`,
      '/project/App.xcworkspace/xcshareddata/xcschemes/Everything.xcscheme': '',
      '/project/App.xcodeproj/xcshareddata/xcschemes/App.xcscheme': '',
      '/project/Modules/Core/Core.xcodeproj/xcshareddata/xcschemes/Core.xcscheme': '',
      '/project/Tools/Tools.xcodeproj/xcshareddata/xcschemes/Tools.xcscheme': '',
      '/project/Unreferenced.xcodeproj/xcshareddata/xcschemes/Unreferenced.xcscheme': '',
    });

    const schemes = await findSharedSchemesAsync('/project/App.xcworkspace');

    expect(schemes.map(({ name, containerPathBase }) => [name, containerPathBase])).toEqual([
      ['Everything', '/project'],
      ['App', '/project'],
      ['Core', '/project/Modules/Core'],
      ['Tools', '/project/Tools'],
    ]);
  });

  it('lists the shared schemes of the projects that a workspace keeps in groups', async () => {
    vol.fromJSON({
      '/project/App.xcworkspace/contents.xcworkspacedata': `<?xml version="1.0" encoding="UTF-8"?>
<Workspace version = "1.0">
  <Group location = "group:Apps" name = "Apps">
    <FileRef location = "group:App/App.xcodeproj"></FileRef>
    <FileRef location = "container:Tools/Tools.xcodeproj"></FileRef>
    <Group location = "group:Modules" name = "Modules">
      <FileRef location = "group:Core.xcodeproj"></FileRef>
    </Group>
  </Group>
</Workspace>`,
      '/project/Apps/App/App.xcodeproj/xcshareddata/xcschemes/App.xcscheme': '',
      '/project/Tools/Tools.xcodeproj/xcshareddata/xcschemes/Tools.xcscheme': '',
      '/project/Apps/Modules/Core.xcodeproj/xcshareddata/xcschemes/Core.xcscheme': '',
    });

    const schemes = await findSharedSchemesAsync('/project/App.xcworkspace');

    expect(schemes.map(({ name, containerPathBase }) => [name, containerPathBase])).toEqual([
      ['App', '/project/Apps/App'],
      ['Tools', '/project/Tools'],
      ['Core', '/project/Apps/Modules'],
    ]);
  });

  it('keeps the scheme of the workspace when a referenced project has a scheme with the same name', async () => {
    vol.fromJSON({
      '/project/App.xcworkspace/contents.xcworkspacedata':
        '<Workspace version = "1.0"><FileRef location = "group:App.xcodeproj"></FileRef></Workspace>',
      '/project/App.xcworkspace/xcshareddata/xcschemes/App.xcscheme': '',
      '/project/App.xcodeproj/xcshareddata/xcschemes/App.xcscheme': '',
    });

    await expect(findSharedSchemesAsync('/project/App.xcworkspace')).resolves.toEqual([
      {
        name: 'App',
        path: '/project/App.xcworkspace/xcshareddata/xcschemes/App.xcscheme',
        containerPathBase: '/project',
      },
    ]);
  });
});

describe(selectScheme, () => {
  it('fails when there is no shared scheme', () => {
    expect(() => selectScheme([], { logger: createMockLogger() })).toThrow(
      expect.objectContaining({ errorCode: 'NATIVE_XCODE_NO_SHARED_SCHEME' })
    );
  });

  it('uses the only shared scheme', () => {
    const logger = createMockLogger();

    expect(selectScheme([createScheme('App')], { logger })).toEqual(createScheme('App'));
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('uses the first scheme by name whose name does not contain tvOS, and logs the candidates', () => {
    const logger = createMockLogger();

    const scheme = selectScheme(
      [createScheme('Widget'), createScheme('App-tvOS'), createScheme('App')],
      { logger }
    );

    expect(scheme).toEqual(createScheme('App'));
    expect(logger.info).toHaveBeenCalledWith(
      'Found 3 shared schemes: App, App-tvOS, Widget. Using "App". Set "xcode_scheme" to build another scheme.'
    );
  });

  it('uses the first scheme by name when every name contains tvOS', () => {
    expect(
      selectScheme([createScheme('B-tvOS'), createScheme('A-tvOS')], {
        logger: createMockLogger(),
      })
    ).toEqual(createScheme('A-tvOS'));
  });

  it('uses the requested scheme', () => {
    expect(
      selectScheme([createScheme('App'), createScheme('Widget')], {
        requestedName: 'Widget',
        logger: createMockLogger(),
      })
    ).toEqual(createScheme('Widget'));
  });

  it('fails with the candidates when the requested scheme is not shared', () => {
    expect(() =>
      selectScheme([createScheme('Widget'), createScheme('App')], {
        requestedName: 'Missing',
        logger: createMockLogger(),
      })
    ).toThrow(
      expect.objectContaining({
        errorCode: 'NATIVE_XCODE_SCHEME_NOT_FOUND',
        message: expect.stringContaining('Shared schemes: App, Widget.'),
      })
    );
  });
});

describe(readSchemeAsync, () => {
  it('reads the application target and the configurations', async () => {
    const scheme = createScheme('App');
    vol.fromJSON({
      [scheme.path]: createSchemeXml({
        buildables: [
          { name: 'Core', product: 'Core.framework', id: 'CORE', container: 'Core/Core.xcodeproj' },
          { name: 'App', product: 'App.app', id: 'APP', container: 'App.xcodeproj' },
        ],
        archiveConfiguration: 'App Store',
        launchConfiguration: 'Development',
      }),
    });

    await expect(readSchemeAsync(scheme)).resolves.toEqual({
      applicationTargetReference: { targetId: 'APP', xcodeprojPath: '/project/App.xcodeproj' },
      archiveConfiguration: 'App Store',
      launchConfiguration: 'Development',
    });
  });

  it('returns no application target when no buildable of the scheme is an application', async () => {
    const scheme = createScheme('Core');
    vol.fromJSON({
      [scheme.path]: createSchemeXml({
        buildables: [
          { name: 'Core', product: 'Core.framework', id: 'CORE', container: 'App.xcodeproj' },
        ],
      }),
    });

    await expect(readSchemeAsync(scheme)).resolves.toEqual({
      applicationTargetReference: undefined,
      archiveConfiguration: 'Release',
      launchConfiguration: 'Debug',
    });
  });
});
