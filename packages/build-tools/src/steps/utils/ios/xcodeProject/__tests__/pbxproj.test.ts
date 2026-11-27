import { vol } from 'memfs';
import path from 'path';

import {
  findApplicationTargetById,
  findDependencyTargets,
  getBuildConfigurations,
  openXcodeProject,
} from '../pbxproj';

const originalFs = jest.requireActual('fs');

const APPLICATION_TARGET_ID = '2870BA69F546F142D461562E';
const FRAMEWORK_TARGET_ID = 'BBCC7F97904CEBE3743A2D6F';
const AGGREGATE_TARGET_ID = 'AA0972AD056CF1AA745384D9';

function openFixtureProject(): ReturnType<typeof openXcodeProject> {
  vol.fromJSON({
    '/project/NativeApp.xcodeproj/project.pbxproj': originalFs.readFileSync(
      path.join(__dirname, 'fixtures/native-app.pbxproj'),
      'utf-8'
    ),
  });
  return openXcodeProject('/project/NativeApp.xcodeproj');
}

afterEach(() => {
  vol.reset();
});

describe(openXcodeProject, () => {
  it('fails with the path when the project file cannot be parsed', () => {
    vol.fromJSON({ '/project/Broken.xcodeproj/project.pbxproj': 'not a project file' });

    expect(() => openXcodeProject('/project/Broken.xcodeproj')).toThrow(
      expect.objectContaining({
        errorCode: 'NATIVE_XCODE_PROJECT_UNREADABLE',
        message: expect.stringContaining('/project/Broken.xcodeproj/project.pbxproj'),
      })
    );
  });
});

describe(findApplicationTargetById, () => {
  it('returns an application target', () => {
    expect(findApplicationTargetById(openFixtureProject(), APPLICATION_TARGET_ID)).toEqual({
      id: APPLICATION_TARGET_ID,
      name: 'NativeApp',
    });
  });

  it.each([
    ['a framework target', FRAMEWORK_TARGET_ID],
    ['an aggregate target', AGGREGATE_TARGET_ID],
    ['an unknown id', 'UNKNOWN'],
  ])('returns nothing for %s', (_description, targetId) => {
    expect(findApplicationTargetById(openFixtureProject(), targetId)).toBeUndefined();
  });
});

describe(findDependencyTargets, () => {
  it('returns the targets a target depends on at any depth, without aggregate targets and Swift package products', () => {
    expect(findDependencyTargets(openFixtureProject(), APPLICATION_TARGET_ID)).toEqual([
      { id: '5CAE5500641C3F327B201839', name: 'Widget' },
      { id: FRAMEWORK_TARGET_ID, name: 'Core' },
      { id: '296D4EDB5005323FF2B08181', name: 'Support' },
    ]);
  });
});

describe(getBuildConfigurations, () => {
  it('returns the build configurations of a target', () => {
    expect(
      getBuildConfigurations(openFixtureProject(), APPLICATION_TARGET_ID).map(({ name }) => name)
    ).toEqual(['Debug', 'Release']);
  });
});
