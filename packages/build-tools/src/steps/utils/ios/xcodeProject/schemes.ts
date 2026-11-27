import { UserError } from '@expo/eas-build-job';
import { bunyan } from '@expo/logger';
import { XMLParser } from 'fast-xml-parser';
import sortBy from 'lodash/sortBy';
import uniqBy from 'lodash/uniqBy';
import fs from 'node:fs';
import path from 'node:path';

import { isWorkspace } from './projectFile';

export interface XcodeScheme {
  name: string;
  path: string;
  containerPathBase: string;
}

export interface XcodeSchemeDetails {
  applicationTargetReference?: {
    targetId: string;
    xcodeprojPath: string;
  };
  archiveConfiguration?: string;
  launchConfiguration?: string;
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  isArray: name => ['BuildActionEntry', 'FileRef', 'Group'].includes(name),
});

export async function findSharedSchemesAsync(projectFilePath: string): Promise<XcodeScheme[]> {
  const schemeOwnersByPrecedence = isWorkspace(projectFilePath)
    ? [projectFilePath, ...(await findWorkspaceProjectsAsync(projectFilePath))]
    : [projectFilePath];

  const schemesByOwner = await Promise.all(
    schemeOwnersByPrecedence.map(async schemeOwner => {
      const schemesDirectory = path.join(schemeOwner, 'xcshareddata', 'xcschemes');
      const fileNames = fs.existsSync(schemesDirectory)
        ? await fs.promises.readdir(schemesDirectory)
        : [];
      return fileNames
        .filter(fileName => path.extname(fileName) === '.xcscheme')
        .map(fileName => ({
          name: path.basename(fileName, '.xcscheme'),
          path: path.join(schemesDirectory, fileName),
          containerPathBase: path.dirname(schemeOwner),
        }));
    })
  );
  return uniqBy(schemesByOwner.flat(), scheme => scheme.name);
}

export function selectScheme(
  schemes: XcodeScheme[],
  { requestedName, logger }: { requestedName?: string; logger: bunyan }
): XcodeScheme {
  const sortedSchemes = sortBy(schemes, scheme => scheme.name);
  const schemeNames = sortedSchemes.map(scheme => scheme.name).join(', ');

  if (sortedSchemes.length === 0) {
    throw new UserError(
      'NATIVE_XCODE_NO_SHARED_SCHEME',
      'Found no shared scheme in the Xcode project. EAS builds a shared scheme, because only shared schemes are stored in the repository. In Xcode, open Product > Scheme > Manage Schemes, select "Shared" for the scheme of the app, and commit the ".xcscheme" file.'
    );
  }
  if (requestedName) {
    const requestedScheme = sortedSchemes.find(scheme => scheme.name === requestedName);
    if (!requestedScheme) {
      throw new UserError(
        'NATIVE_XCODE_SCHEME_NOT_FOUND',
        `"xcode_scheme" is "${requestedName}", but the Xcode project has no shared scheme with this name. Shared schemes: ${schemeNames}. Set "xcode_scheme" to one of them, or mark the scheme as "Shared" in Xcode and commit its ".xcscheme" file.`
      );
    }
    return requestedScheme;
  }

  const firstSchemeNotForTvos = sortedSchemes.find(({ name }) => !name.includes('tvOS'));
  const scheme = firstSchemeNotForTvos ?? sortedSchemes[0];
  if (sortedSchemes.length > 1) {
    logger.info(
      `Found ${sortedSchemes.length} shared schemes: ${schemeNames}. Using "${scheme.name}". Set "xcode_scheme" to build another scheme.`
    );
  }
  return scheme;
}

export async function readSchemeAsync(scheme: XcodeScheme): Promise<XcodeSchemeDetails> {
  const { Scheme } = xmlParser.parse(await fs.promises.readFile(scheme.path, 'utf8'));
  const applicationReference: Record<string, string | undefined> | undefined = (
    Scheme?.BuildAction?.BuildActionEntries?.BuildActionEntry ?? []
  )
    .map((entry: any) => entry.BuildableReference)
    .find((reference: any) => reference?.BuildableName?.endsWith('.app'));

  return {
    applicationTargetReference:
      applicationReference?.BlueprintIdentifier && applicationReference.ReferencedContainer
        ? {
            targetId: applicationReference.BlueprintIdentifier,
            xcodeprojPath: path.resolve(
              scheme.containerPathBase,
              applicationReference.ReferencedContainer.replace(/^container:/, '')
            ),
          }
        : undefined,
    archiveConfiguration: Scheme?.ArchiveAction?.buildConfiguration,
    launchConfiguration: Scheme?.LaunchAction?.buildConfiguration,
  };
}

interface WorkspaceGroup {
  location?: string;
  FileRef?: { location: string }[];
  Group?: WorkspaceGroup[];
}

async function findWorkspaceProjectsAsync(workspacePath: string): Promise<string[]> {
  const { Workspace } = xmlParser.parse(
    await fs.promises.readFile(path.join(workspacePath, 'contents.xcworkspacedata'), 'utf8')
  );
  const workspaceDirectory = path.dirname(workspacePath);
  // Xcode: "group:" is relative to the enclosing group, "container:" to the workspace directory.
  const resolveLocation = (location: string, groupDirectory: string): string =>
    location.startsWith('container:')
      ? path.resolve(workspaceDirectory, location.slice('container:'.length))
      : path.resolve(groupDirectory, location.replace(/^group:/, ''));
  const listFileLocations = (group: WorkspaceGroup, groupDirectory: string): string[] => [
    ...(group.FileRef ?? []).map(({ location }) => resolveLocation(location, groupDirectory)),
    ...(group.Group ?? []).flatMap(subgroup =>
      listFileLocations(subgroup, resolveLocation(subgroup.location ?? '', groupDirectory))
    ),
  ];
  return listFileLocations(Workspace ?? {}, workspaceDirectory).filter(
    location => path.extname(location) === '.xcodeproj'
  );
}
