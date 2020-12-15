import { waitForBuildEndAsync } from '../pollingLogger';
import mocks from './fixtures/multi-build-success.json';

describe(waitForBuildEndAsync, () => {
  it(`logs multiple builds at once`, async () => {
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
