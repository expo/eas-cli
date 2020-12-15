import { waitForBuildEndAsync } from '../pollingLogger';

describe(waitForBuildEndAsync, () => {
  it(`logs multiple builds at once`, async () => {
    const mocks = require('./fixtures/multi-build-fail.json');
    let i = 0;
    await waitForBuildEndAsync(
      {
        projectId: 'XXX',
      },
      {
        intervalSec: 0.5,
        buildIds: ['foo', 'bar'],
        async requestBuildsAsync() {
          const builds = mocks[i];
          i++;
          return builds as any;
        },
      }
    );
  });
  it(`logs builds where one fails`, async () => {
    const mocks = require('./fixtures/multi-build-fail.json');
    let i = 0;
    await waitForBuildEndAsync(
      {
        projectId: 'XXX',
      },
      {
        intervalSec: 0.5,
        buildIds: ['foo', 'bar'],
        async requestBuildsAsync() {
          const builds = mocks[i];
          i++;
          return builds as any;
        },
      }
    );
  });
});
