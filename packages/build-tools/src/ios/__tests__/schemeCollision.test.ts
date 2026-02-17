import { vol } from 'memfs';

import { assertNoPodSchemeNameCollisionAsync } from '../schemeCollision';

describe(assertNoPodSchemeNameCollisionAsync, () => {
  const projectRoot = '/app';

  it('does not throw when there is no pod scheme collision', async () => {
    vol.fromJSON(
      {
        'ios/testapp.xcodeproj/xcshareddata/xcschemes/FruitVision.xcscheme': 'fakecontents',
      },
      projectRoot
    );

    await expect(assertNoPodSchemeNameCollisionAsync(projectRoot, 'FruitVision')).resolves.toBe(
      undefined
    );
  });

  it('throws when pod scheme name collides with app scheme', async () => {
    vol.fromJSON(
      {
        'ios/testapp.xcodeproj/xcshareddata/xcschemes/FruitVision.xcscheme': 'fakecontents',
        'ios/Pods/Pods.xcodeproj/xcshareddata/xcschemes/FruitVision.xcscheme': 'fakecontents',
      },
      projectRoot
    );

    await expect(assertNoPodSchemeNameCollisionAsync(projectRoot, 'FruitVision')).rejects.toThrow(
      /scheme name collision/
    );
  });
});
