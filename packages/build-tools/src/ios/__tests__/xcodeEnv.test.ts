import { Ios } from '@expo/eas-build-job';
import { bunyan } from '@expo/logger';
import fs from 'fs-extra';
import { vol } from 'memfs';
import { instance, mock, when, verify } from 'ts-mockito';

import { BuildContext } from '../../context';
import { deleteXcodeEnvLocalIfExistsAsync } from '../xcodeEnv';

jest.mock('fs');

afterEach(() => {
  vol.reset();
});

describe(deleteXcodeEnvLocalIfExistsAsync, () => {
  it('removes ios/.xcode.env.local if exists + calls ctx.markBuildPhaseHasWarnings', async () => {
    vol.fromJSON(
      {
        'ios/.xcode.env': '# lorem ipsum',
        'ios/.xcode.env.local': '# lorem ipsum',
      },
      '/app'
    );

    const mockCtx = mock<BuildContext<Ios.Job>>();
    when(mockCtx.getReactNativeProjectDirectory()).thenReturn('/app');
    when(mockCtx.logger).thenReturn(instance(mock<bunyan>()));
    const ctx = instance(mockCtx);

    await deleteXcodeEnvLocalIfExistsAsync(ctx);

    await expect(fs.pathExists('/app/ios/.xcode.env')).resolves.toBe(true);
    await expect(fs.pathExists('/app/ios/.xcode.env.local')).resolves.toBe(false);

    // eslint-disable-next-line @typescript-eslint/no-confusing-void-expression
    verify(mockCtx.markBuildPhaseHasWarnings()).called();
  });
});
