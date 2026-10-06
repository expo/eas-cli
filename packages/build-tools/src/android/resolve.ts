import { Android } from '@expo/eas-build-job';

export function resolveArtifactPath(job: Android.Job): string {
  return job.applicationArchivePath ?? 'android/app/build/outputs/**/*.{apk,aab}';
}
