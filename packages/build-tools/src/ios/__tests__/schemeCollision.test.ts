import { vol } from 'memfs';

import { assertNoPodSchemeNameCollision } from '../schemeCollision';

describe(assertNoPodSchemeNameCollision, () => {
  const projectRoot = '/app';

  it('does not throw when there is no pod scheme collision', () => {
    vol.fromJSON(
      {
        'ios/testapp.xcodeproj/xcshareddata/xcschemes/FruitVision.xcscheme': 'fakecontents',
      },
      projectRoot
    );

    expect(() =>
      assertNoPodSchemeNameCollision({
        projectDir: projectRoot,
        buildScheme: 'FruitVision',
      })
    ).not.toThrow();
  });

  it('throws when pod scheme name collides with app scheme', () => {
    vol.fromJSON(
      {
        'ios/testapp.xcodeproj/xcshareddata/xcschemes/FruitVision.xcscheme': 'fakecontents',
        'ios/Pods/Pods.xcodeproj/xcshareddata/xcschemes/FruitVision.xcscheme': 'fakecontents',
      },
      projectRoot
    );

    expect(() =>
      assertNoPodSchemeNameCollision({
        projectDir: projectRoot,
        buildScheme: 'FruitVision',
      })
    ).toThrow(/scheme name collision/);
  });
});
