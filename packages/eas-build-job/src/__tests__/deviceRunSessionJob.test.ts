import { randomUUID } from 'crypto';
import { ZodError } from 'zod';

import { ArchiveSourceType, BuildTrigger, EnvironmentSecretType, Platform } from '../common';
import { DeviceRunSession } from '../deviceRunSessionJob';

function createIosWebPreviewJob(
  overrides: Partial<DeviceRunSession.Job> = {}
): DeviceRunSession.Job {
  return {
    type: DeviceRunSession.JobType.DEVICE_RUN_SESSION,
    triggeredBy: BuildTrigger.GIT_BASED_INTEGRATION,
    projectArchive: { type: ArchiveSourceType.NONE },
    secrets: {
      robotAccessToken: 'token',
      environmentSecrets: [
        { name: 'NGROK_AUTHTOKEN', value: 'ngrok-token', type: EnvironmentSecretType.STRING },
      ],
    },
    expoDevUrl: 'https://expo.dev/',
    builderEnvironment: {
      image: 'latest',
      env: { npm_config_audit: 'false' },
    },
    initiatingUserId: randomUUID(),
    appId: randomUUID(),
    session: {
      id: randomUUID(),
      controller: DeviceRunSession.Controller.WEB_PREVIEW_ONLY,
      maxDurationSeconds: 2400,
      ngrokTunnelDomain: 'sim.example.test',
    },
    device: { platform: Platform.IOS, deviceIdentifier: 'iPhone 16 Pro' },
    application: {
      source: { buildId: randomUUID() },
      launchArgs: ['-EXDevMenuIsOnboardingFinished', '1'],
      openUrl: 'exp://127.0.0.1:8081',
    },
    ...overrides,
  };
}

describe('DeviceRunSession.JobZ', () => {
  it('accepts an iOS web preview session that installs an EAS Build', () => {
    const job = createIosWebPreviewJob();
    expect(DeviceRunSession.JobZ.parse(job)).toEqual(job);
  });

  it('accepts an Android agent-device session that installs an archive URL', () => {
    const job = createIosWebPreviewJob({
      session: {
        id: randomUUID(),
        controller: DeviceRunSession.Controller.AGENT_DEVICE,
        maxDurationSeconds: 1800,
        maxIdleTimeMinutes: 10,
        packageVersion: '0.4.2',
        ngrokTunnelDomain: 'sim.example.test',
      },
      device: {
        platform: Platform.ANDROID,
        deviceIdentifier: 'medium_phone',
        systemImagePackage: 'system-images;android-35-ext15;google_apis_playstore;x86_64',
        lcdWidth: 720,
        lcdHeight: 1600,
        lcdDensity: 300,
      },
      application: {
        source: { archiveUrl: 'https://example.test/app.apk' },
      },
    });
    expect(DeviceRunSession.JobZ.parse(job)).toEqual(job);
  });

  it('accepts a session without an application and with local egress on iOS', () => {
    const job = createIosWebPreviewJob({
      application: undefined,
      egress: DeviceRunSession.Egress.LOCAL,
    });
    expect(DeviceRunSession.JobZ.parse(job)).toEqual(job);
  });

  it('rejects local egress on Android', () => {
    const job = createIosWebPreviewJob({
      device: {
        platform: Platform.ANDROID,
        deviceIdentifier: 'medium_phone',
        systemImagePackage: 'system-images;android-35-ext15;google_apis_playstore;x86_64',
      },
      egress: DeviceRunSession.Egress.LOCAL,
    });
    expect(() => DeviceRunSession.JobZ.parse(job)).toThrow(ZodError);
  });

  it('rejects an idle timeout that is not shorter than the session duration', () => {
    const job = createIosWebPreviewJob({
      session: {
        id: randomUUID(),
        controller: DeviceRunSession.Controller.APPIUM,
        maxDurationSeconds: 600,
        maxIdleTimeMinutes: 10,
        ngrokTunnelDomain: 'sim.example.test',
      },
    });
    expect(() => DeviceRunSession.JobZ.parse(job)).toThrow(ZodError);
  });

  it('rejects an application with two sources', () => {
    const job = createIosWebPreviewJob({
      application: {
        source: { buildId: randomUUID(), archiveUrl: 'https://example.test/app.tar.gz' } as never,
      },
    });
    expect(() => DeviceRunSession.JobZ.parse(job)).toThrow(ZodError);
  });

  it('rejects a build job type in the discriminator slot', () => {
    const job = { ...createIosWebPreviewJob(), type: 'generic' };
    expect(() => DeviceRunSession.JobZ.parse(job)).toThrow(ZodError);
  });

  it('rejects a job that sets platform', () => {
    const job = { ...createIosWebPreviewJob(), platform: Platform.IOS };
    expect(() => DeviceRunSession.JobZ.parse(job)).toThrow(ZodError);
  });

  it('rejects a missing session id', () => {
    const { session, ...job } = createIosWebPreviewJob();
    expect(() => DeviceRunSession.JobZ.parse({ ...job, session: { ...session, id: '' } })).toThrow(
      ZodError
    );
  });
});
