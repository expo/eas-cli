import { Platform, Workflow } from '@expo/eas-build-job';
import { ExitError } from '@oclif/core/lib/errors';
import path from 'path';
import { instance, mock, when } from 'ts-mockito';

import { CommonContext } from '../context';
import { validatePNGsForManagedProjectAsync } from '../validate';

const fixturesPath = path.join(__dirname, 'fixtures');

describe(validatePNGsForManagedProjectAsync, () => {
  it('does not validate PNGs for generic projects', async () => {
    const ctxMock = mock<CommonContext<Platform.ANDROID>>();
    when(ctxMock.workflow).thenReturn(Workflow.GENERIC);
    const ctx = instance(ctxMock);
    await expect(validatePNGsForManagedProjectAsync(ctx)).resolves.not.toThrow();
  });

  it('does not validate PNGs for projects with SDK >= 47', async () => {
    const ctxMock = mock<CommonContext<Platform.ANDROID>>();
    when(ctxMock.workflow).thenReturn(Workflow.GENERIC);
    when(ctxMock.exp).thenReturn({
      name: 'blah',
      slug: 'blah',
      android: { adaptiveIcon: { foregroundImage: 'assets/icon.jpg' } },
      sdkVersion: '47.0.0',
    });
    const ctx = instance(ctxMock);
    await expect(validatePNGsForManagedProjectAsync(ctx)).resolves.not.toThrow();
  });

  describe(Platform.ANDROID, () => {
    it('exits if foregroundImage is not a file with .png extension', async () => {
      const ctxMock = mock<CommonContext<Platform.ANDROID>>();
      when(ctxMock.workflow).thenReturn(Workflow.MANAGED);
      when(ctxMock.platform).thenReturn(Platform.ANDROID);
      when(ctxMock.exp).thenReturn({
        name: 'blah',
        slug: 'blah',
        android: { adaptiveIcon: { foregroundImage: 'assets/icon.jpg' } },
        sdkVersion: '46.0.0',
      });
      const ctx = instance(ctxMock);

      await expect(validatePNGsForManagedProjectAsync(ctx)).rejects.toThrow(ExitError);
    });

    it('exits if foregroundImage is not a png file', async () => {
      const ctxMock = mock<CommonContext<Platform.ANDROID>>();
      when(ctxMock.workflow).thenReturn(Workflow.MANAGED);
      when(ctxMock.platform).thenReturn(Platform.ANDROID);
      when(ctxMock.exp).thenReturn({
        name: 'blah',
        slug: 'blah',
        android: { adaptiveIcon: { foregroundImage: path.join(fixturesPath, 'icon-jpg.png') } },
        sdkVersion: '46.0.0',
      });
      const ctx = instance(ctxMock);

      await expect(validatePNGsForManagedProjectAsync(ctx)).rejects.toThrow(ExitError);
    });

    it('does not throw if foregroundImage is a png file', async () => {
      const ctxMock = mock<CommonContext<Platform.ANDROID>>();
      when(ctxMock.workflow).thenReturn(Workflow.MANAGED);
      when(ctxMock.platform).thenReturn(Platform.ANDROID);
      when(ctxMock.exp).thenReturn({
        name: 'blah',
        slug: 'blah',
        android: { adaptiveIcon: { foregroundImage: path.join(fixturesPath, 'icon-alpha.png') } },
        sdkVersion: '46.0.0',
      });
      const ctx = instance(ctxMock);

      await expect(validatePNGsForManagedProjectAsync(ctx)).resolves.not.toThrow();
    });
  });

  // Validating iOS PNGs is currently disabled
  // See https://github.com/expo/eas-cli/pull/1477 for context
  xdescribe(Platform.IOS, () => {
    it('exits if icon is not a file with .png extension', async () => {
      const ctxMock = mock<CommonContext<Platform.IOS>>();
      when(ctxMock.workflow).thenReturn(Workflow.MANAGED);
      when(ctxMock.platform).thenReturn(Platform.IOS);
      when(ctxMock.exp).thenReturn({
        name: 'blah',
        slug: 'blah',
        ios: { icon: path.join(fixturesPath, 'assets/icon.jpg') },
        sdkVersion: '46.0.0',
      });
      const ctx = instance(ctxMock);

      await expect(validatePNGsForManagedProjectAsync(ctx)).rejects.toThrow(ExitError);
    });

    it('exits if icon is not a png file', async () => {
      const ctxMock = mock<CommonContext<Platform.IOS>>();
      when(ctxMock.workflow).thenReturn(Workflow.MANAGED);
      when(ctxMock.platform).thenReturn(Platform.IOS);
      when(ctxMock.exp).thenReturn({
        name: 'blah',
        slug: 'blah',
        ios: { icon: path.join(fixturesPath, 'icon-jpg.png') },
        sdkVersion: '46.0.0',
      });
      const ctx = instance(ctxMock);

      await expect(validatePNGsForManagedProjectAsync(ctx)).rejects.toThrow(ExitError);
    });

    it('exits if icon has alpha channel (transparency)', async () => {
      const ctxMock = mock<CommonContext<Platform.IOS>>();
      when(ctxMock.workflow).thenReturn(Workflow.MANAGED);
      when(ctxMock.platform).thenReturn(Platform.IOS);
      when(ctxMock.exp).thenReturn({
        name: 'blah',
        slug: 'blah',
        ios: { icon: path.join(fixturesPath, 'icon-alpha.png') },
        sdkVersion: '46.0.0',
      });
      const ctx = instance(ctxMock);

      await expect(validatePNGsForManagedProjectAsync(ctx)).rejects.toThrow(ExitError);
    });

    it('does not throw if icon is a png file and does not have alpha channel', async () => {
      const ctxMock = mock<CommonContext<Platform.IOS>>();
      when(ctxMock.workflow).thenReturn(Workflow.MANAGED);
      when(ctxMock.platform).thenReturn(Platform.IOS);
      when(ctxMock.exp).thenReturn({
        name: 'blah',
        slug: 'blah',
        ios: { icon: path.join(fixturesPath, 'icon-no-alpha.png') },
        sdkVersion: '46.0.0',
      });
      const ctx = instance(ctxMock);

      await expect(validatePNGsForManagedProjectAsync(ctx)).resolves.not.toThrow();
    });
  });
});
