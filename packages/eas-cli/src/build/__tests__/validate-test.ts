import { Platform, Workflow } from '@expo/eas-build-job';
import { ExitError } from '@oclif/core/lib/errors';
import path from 'path';
import { instance, mock, when } from 'ts-mockito';

import { CommonContext } from '../context';
import { validateIconForManagedProjectAsync } from '../validate';

const fixturesPath = path.join(__dirname, 'fixtures');

describe(validateIconForManagedProjectAsync, () => {
  it('does not validate the icons for generic projects', async () => {
    const ctxMock = mock<CommonContext<Platform.ANDROID>>();
    when(ctxMock.workflow).thenReturn(Workflow.GENERIC);
    const ctx = instance(ctxMock);
    await expect(validateIconForManagedProjectAsync(ctx)).resolves.not.toThrow();
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
      });
      const ctx = instance(ctxMock);

      await expect(validateIconForManagedProjectAsync(ctx)).rejects.toThrow(ExitError);
    });

    it('exits if foregroundImage is not a png file', async () => {
      const ctxMock = mock<CommonContext<Platform.ANDROID>>();
      when(ctxMock.workflow).thenReturn(Workflow.MANAGED);
      when(ctxMock.platform).thenReturn(Platform.ANDROID);
      when(ctxMock.exp).thenReturn({
        name: 'blah',
        slug: 'blah',
        android: { adaptiveIcon: { foregroundImage: path.join(fixturesPath, 'icon-jpg.png') } },
      });
      const ctx = instance(ctxMock);

      await expect(validateIconForManagedProjectAsync(ctx)).rejects.toThrow(ExitError);
    });

    it('does not throw if foregroundImage is a png file', async () => {
      const ctxMock = mock<CommonContext<Platform.ANDROID>>();
      when(ctxMock.workflow).thenReturn(Workflow.MANAGED);
      when(ctxMock.platform).thenReturn(Platform.ANDROID);
      when(ctxMock.exp).thenReturn({
        name: 'blah',
        slug: 'blah',
        android: { adaptiveIcon: { foregroundImage: path.join(fixturesPath, 'icon-alpha.png') } },
      });
      const ctx = instance(ctxMock);

      await expect(validateIconForManagedProjectAsync(ctx)).resolves.not.toThrow();
    });
  });

  describe(Platform.IOS, () => {
    it('exits if icon is not a file with .png extension', async () => {
      const ctxMock = mock<CommonContext<Platform.IOS>>();
      when(ctxMock.workflow).thenReturn(Workflow.MANAGED);
      when(ctxMock.platform).thenReturn(Platform.IOS);
      when(ctxMock.exp).thenReturn({
        name: 'blah',
        slug: 'blah',
        ios: { icon: path.join(fixturesPath, 'assets/icon.jpg') },
      });
      const ctx = instance(ctxMock);

      await expect(validateIconForManagedProjectAsync(ctx)).rejects.toThrow(ExitError);
    });

    it('exits if icon is not a png file', async () => {
      const ctxMock = mock<CommonContext<Platform.IOS>>();
      when(ctxMock.workflow).thenReturn(Workflow.MANAGED);
      when(ctxMock.platform).thenReturn(Platform.IOS);
      when(ctxMock.exp).thenReturn({
        name: 'blah',
        slug: 'blah',
        ios: { icon: path.join(fixturesPath, 'icon-jpg.png') },
      });
      const ctx = instance(ctxMock);

      await expect(validateIconForManagedProjectAsync(ctx)).rejects.toThrow(ExitError);
    });

    it('exits if icon has alpha channel (transparency)', async () => {
      const ctxMock = mock<CommonContext<Platform.IOS>>();
      when(ctxMock.workflow).thenReturn(Workflow.MANAGED);
      when(ctxMock.platform).thenReturn(Platform.IOS);
      when(ctxMock.exp).thenReturn({
        name: 'blah',
        slug: 'blah',
        ios: { icon: path.join(fixturesPath, 'icon-alpha.png') },
      });
      const ctx = instance(ctxMock);

      await expect(validateIconForManagedProjectAsync(ctx)).rejects.toThrow(ExitError);
    });

    it('does not throw if icon is a png file and does not have alpha channel', async () => {
      const ctxMock = mock<CommonContext<Platform.IOS>>();
      when(ctxMock.workflow).thenReturn(Workflow.MANAGED);
      when(ctxMock.platform).thenReturn(Platform.IOS);
      when(ctxMock.exp).thenReturn({
        name: 'blah',
        slug: 'blah',
        ios: { icon: path.join(fixturesPath, 'icon-no-alpha.png') },
      });
      const ctx = instance(ctxMock);

      await expect(validateIconForManagedProjectAsync(ctx)).resolves.not.toThrow();
    });
  });
});
