import { LoggerLevel } from '@expo/logger';
import { z } from 'zod';

import {
  ArchiveSourceSchemaZ,
  BuildTrigger,
  EnvironmentSecretZ,
  Platform,
  SshSettingsZ,
} from './common';
import { Generic } from './generic';

/**
 * Job payload for an EAS Simulator device run session.
 *
 * Unlike `Generic.Job`, this payload describes the session the API server wants
 * (device, application, controller) instead of listing `eas/*` steps. The worker
 * plans and runs the session lifecycle itself, so work that does not need the
 * device can run while it boots, and the lifecycle has one home.
 *
 * `type` doubles as the job-family discriminator: build jobs carry a `Workflow`
 * value there, generic jobs carry `undefined`, and session jobs carry
 * `JobType.DEVICE_RUN_SESSION`.
 */
export namespace DeviceRunSession {
  export enum JobType {
    DEVICE_RUN_SESSION = 'device-run-session',
  }

  /** The tool that gives clients access to the device once the session is live. */
  export enum Controller {
    /** Interactive web preview only: serve-sim on iOS, expo-device-hub on Android. */
    WEB_PREVIEW_ONLY = 'web-preview-only',
    AGENT_DEVICE = 'agent-device',
    ARGENT = 'argent',
    APPIUM = 'appium',
  }

  /** Where the device's proxied network traffic exits. Unset means EAS infrastructure. */
  export enum Egress {
    LOCAL = 'local',
  }

  export const SessionZ = z.object({
    /** Device run session id in the API server. The worker reports the remote session to it. */
    id: z.string().min(1),
    controller: z.nativeEnum(Controller),
    /** Usable session time, counted from the moment the remote session is published. */
    maxDurationSeconds: z.number().int().positive(),
    /** Stop the session after this many minutes without controller activity. */
    maxIdleTimeMinutes: z.number().int().positive().optional(),
    /** Controller package version to run. Unset means latest. */
    packageVersion: z.string().min(1).optional(),
    /** Base domain for the session's ngrok tunnels. */
    ngrokTunnelDomain: z.string().min(1),
  });
  export type Session = z.infer<typeof SessionZ>;

  export const IosDeviceZ = z.object({
    platform: z.literal(Platform.IOS),
    /** Simulator name or UDID. Unset picks the most generic available iPhone. */
    deviceIdentifier: z.string().min(1).optional(),
  });
  export type IosDevice = z.infer<typeof IosDeviceZ>;

  export const AndroidDeviceZ = z.object({
    platform: z.literal(Platform.ANDROID),
    /** AVD hardware profile id, for example `medium_phone`. */
    deviceIdentifier: z.string().min(1),
    /** SDK system image package, for example `system-images;android-35-ext15;google_apis_playstore;x86_64`. */
    systemImagePackage: z.string().min(1),
    lcdWidth: z.number().int().positive().optional(),
    lcdHeight: z.number().int().positive().optional(),
    lcdDensity: z.number().int().positive().optional(),
  });
  export type AndroidDevice = z.infer<typeof AndroidDeviceZ>;

  export const DeviceZ = z.discriminatedUnion('platform', [IosDeviceZ, AndroidDeviceZ]);
  export type Device = z.infer<typeof DeviceZ>;

  /** Exactly one source: an EAS Build id or a direct application archive URL. */
  export const ApplicationSourceZ = z.union([
    z.strictObject({ buildId: z.string().uuid() }),
    z.strictObject({ archiveUrl: z.string().url() }),
  ]);
  export type ApplicationSource = z.infer<typeof ApplicationSourceZ>;

  export const ApplicationZ = z.object({
    source: ApplicationSourceZ,
    /** Passed to the application on launch. On Android these are `am start` intent arguments. */
    launchArgs: z.array(z.string()).optional(),
    /** Opened in the application after launch. */
    openUrl: z.string().url().optional(),
  });
  export type Application = z.infer<typeof ApplicationZ>;

  export const JobZ = z
    .object({
      type: z.literal(JobType.DEVICE_RUN_SESSION),
      // Build jobs set `platform`; session jobs and generic jobs never do.
      platform: z.never().optional(),
      triggeredBy: z.literal(BuildTrigger.GIT_BASED_INTEGRATION),
      projectArchive: ArchiveSourceSchemaZ,
      secrets: z.object({
        robotAccessToken: z.string(),
        environmentSecrets: z.array(EnvironmentSecretZ),
      }),
      expoDevUrl: z.string().url(),
      builderEnvironment: Generic.BuilderEnvironmentSchemaZ,
      loggerLevel: z.nativeEnum(LoggerLevel).optional(),
      initiatingUserId: z.string(),
      appId: z.string(),
      ssh: SshSettingsZ.optional(),

      session: SessionZ,
      device: DeviceZ,
      /** Application to install and launch before the remote session is published. */
      application: ApplicationZ.optional(),
      egress: z.nativeEnum(Egress).optional(),
    })
    .refine(job => job.egress !== Egress.LOCAL || job.device.platform === Platform.IOS, {
      message: 'Local egress is only supported for iOS devices.',
      path: ['egress'],
    })
    .refine(
      job =>
        job.session.maxIdleTimeMinutes === undefined ||
        job.session.maxIdleTimeMinutes * 60 < job.session.maxDurationSeconds,
      {
        message: 'maxIdleTimeMinutes must be smaller than maxDurationSeconds.',
        path: ['session', 'maxIdleTimeMinutes'],
      }
    );
  export type Job = z.infer<typeof JobZ>;
}
