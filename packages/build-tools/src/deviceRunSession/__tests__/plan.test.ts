import { ArchiveSourceType, BuildTrigger, DeviceRunSession, Platform } from '@expo/eas-build-job';
import { randomUUID } from 'node:crypto';

import { validateTaskGraph } from '../graph';
import { planDeviceRunSession } from '../plan';
import { type SessionTask } from '../runtime';

function createJob({
  controller = DeviceRunSession.Controller.WEB_PREVIEW_ONLY,
  platform = Platform.IOS,
  withApplication = true,
  egress,
}: {
  controller?: DeviceRunSession.Controller;
  platform?: Platform;
  withApplication?: boolean;
  egress?: DeviceRunSession.Egress;
} = {}): DeviceRunSession.Job {
  return {
    type: DeviceRunSession.JobType.DEVICE_RUN_SESSION,
    triggeredBy: BuildTrigger.GIT_BASED_INTEGRATION,
    projectArchive: { type: ArchiveSourceType.NONE },
    secrets: { robotAccessToken: 'token', environmentSecrets: [] },
    expoDevUrl: 'https://expo.dev/',
    builderEnvironment: { image: 'latest', env: {} },
    initiatingUserId: randomUUID(),
    appId: randomUUID(),
    session: {
      id: randomUUID(),
      controller,
      maxDurationSeconds: 1200,
      ngrokTunnelDomain: 'sim.example.test',
    },
    device:
      platform === Platform.IOS
        ? { platform: Platform.IOS }
        : {
            platform: Platform.ANDROID,
            deviceIdentifier: 'medium_phone',
            systemImagePackage: 'system-images;android-35;google_apis;x86_64',
          },
    ...(withApplication ? { application: { source: { buildId: randomUUID() } } } : {}),
    ...(egress ? { egress } : {}),
  };
}

function byId(tasks: SessionTask[]): Record<string, SessionTask> {
  return Object.fromEntries(tasks.map(task => [task.id, task]));
}

describe(planDeviceRunSession, () => {
  it('plans an iOS web preview session that installs an application', () => {
    const tasks = planDeviceRunSession(createJob());
    validateTaskGraph(tasks);

    expect(tasks.map(task => task.id)).toEqual([
      'select_xcode',
      'boot_device',
      'prefetch_tooling',
      'fetch_turn_credentials',
      'start_pollers',
      'download_build',
      'start_preview',
      'install_build',
      'launch_application',
      'publish_remote_config',
      'hold_session',
    ]);
    const plan = byId(tasks);
    expect(plan.boot_device.needs).toEqual(['select_xcode']);
    expect(plan.download_build.needs ?? []).toEqual([]);
    expect(plan.start_preview).toMatchObject({
      needs: ['boot_device'],
      after: ['prefetch_tooling', 'fetch_turn_credentials'],
    });
    expect(plan.install_build.needs).toEqual(['boot_device', 'download_build']);
    expect(plan.launch_application.needs).toEqual(['install_build']);
    expect(plan.publish_remote_config).toMatchObject({
      needs: ['start_preview'],
      after: ['launch_application'],
    });
    expect(plan.hold_session.needs).toEqual(['publish_remote_config']);
  });

  it('lets the device stay usable when the application cannot be installed', () => {
    const plan = byId(planDeviceRunSession(createJob()));
    expect(plan.download_build.onFailure).toBe('degrade-application');
    expect(plan.install_build.onFailure).toBe('degrade-application');
    expect(plan.launch_application.onFailure).toBe('degrade-application');
    expect(plan.prefetch_tooling.onFailure).toBe('warn');
    expect(plan.fetch_turn_credentials.onFailure).toBe('warn');
    expect(plan.boot_device.onFailure).toBe('fail-session');
    expect(plan.start_preview.onFailure).toBe('fail-session');
    expect(plan.publish_remote_config.onFailure).toBe('fail-session');
  });

  it('starts local egress before the device boots on iOS', () => {
    const plan = byId(planDeviceRunSession(createJob({ egress: DeviceRunSession.Egress.LOCAL })));
    expect(plan.start_local_egress.onFailure).toBe('fail-session');
    expect(plan.boot_device.needs).toEqual(['select_xcode', 'start_local_egress']);
  });

  it('plans an Android agent-device session without an application', () => {
    const tasks = planDeviceRunSession(
      createJob({
        controller: DeviceRunSession.Controller.AGENT_DEVICE,
        platform: Platform.ANDROID,
        withApplication: false,
      })
    );
    validateTaskGraph(tasks);

    const ids = tasks.map(task => task.id);
    expect(ids).not.toContain('select_xcode');
    expect(ids).not.toContain('start_pollers');
    expect(ids).not.toContain('download_build');
    const plan = byId(tasks);
    expect(plan.boot_device.needs).toEqual([]);
    // The agent-device daemon does not need the device to start.
    expect(plan.start_controller).toMatchObject({ needs: [], after: ['prefetch_tooling'] });
    expect(plan.publish_remote_config).toMatchObject({
      needs: ['start_preview', 'start_controller'],
      after: [],
    });
  });

  it.each([DeviceRunSession.Controller.ARGENT, DeviceRunSession.Controller.APPIUM])(
    'makes the %s controller wait for the device',
    controller => {
      const plan = byId(planDeviceRunSession(createJob({ controller })));
      expect(plan.start_controller.needs).toEqual(['select_xcode', 'boot_device']);
    }
  );

  it('produces a valid graph for every controller, platform, application, and egress combination', () => {
    for (const controller of Object.values(DeviceRunSession.Controller)) {
      for (const platform of [Platform.IOS, Platform.ANDROID]) {
        for (const withApplication of [true, false]) {
          for (const egress of [undefined, DeviceRunSession.Egress.LOCAL]) {
            if (egress && platform !== Platform.IOS) {
              continue;
            }
            const tasks = planDeviceRunSession(
              createJob({ controller, platform, withApplication, egress })
            );
            expect(() => validateTaskGraph(tasks)).not.toThrow();
            expect(tasks.at(-1)?.id).toBe('hold_session');
          }
        }
      }
    }
  });
});
