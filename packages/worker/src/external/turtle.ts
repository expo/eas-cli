import { Platform } from '@expo/eas-build-job';

export enum ResourceClass {
  ANDROID_N2_1_3_12 = 'android-n2-1.3-12',
  ANDROID_N2_2_6_24 = 'android-n2-2.6-24',
  IOS_M1_4_16 = 'ios-m1-4-16',
  IOS_M2_2_8 = 'ios-m2-2-8',
  IOS_M2_PRO_4_12 = 'ios-m2-pro-4-12',
  IOS_M2_4_22 = 'ios-m2-4-22',
  IOS_M4_PRO_5_20 = 'ios-m4-pro-5-20',
  IOS_M4_PRO_10_40 = 'ios-m4-pro-10-40',
  LINUX_C3D_STANDARD_4 = 'linux-c3d-standard-4',
  LINUX_C3D_STANDARD_8 = 'linux-c3d-standard-8',
  LINUX_C4D_STANDARD_4 = 'linux-c4d-standard-4',
  LINUX_C4D_STANDARD_8 = 'linux-c4d-standard-8',
}

export const ResourceClassToPlatform: Record<ResourceClass, Platform> = {
  'android-n2-1.3-12': Platform.ANDROID,
  'android-n2-2.6-24': Platform.ANDROID,
  'ios-m1-4-16': Platform.IOS,
  'ios-m2-2-8': Platform.IOS,
  'ios-m2-4-22': Platform.IOS,
  'ios-m2-pro-4-12': Platform.IOS,
  'ios-m4-pro-5-20': Platform.IOS,
  'ios-m4-pro-10-40': Platform.IOS,
  [ResourceClass.LINUX_C3D_STANDARD_4]: Platform.ANDROID,
  [ResourceClass.LINUX_C3D_STANDARD_8]: Platform.ANDROID,
  [ResourceClass.LINUX_C4D_STANDARD_4]: Platform.ANDROID,
  [ResourceClass.LINUX_C4D_STANDARD_8]: Platform.ANDROID,
};

export const androidImagesWithJavaVersionLowerThen11 = [
  'ubuntu-20.04-jdk-8-ndk-r19c',
  'ubuntu-20.04-jdk-11-ndk-r19c',
  'ubuntu-20.04-jdk-8-ndk-r21e',
  'ubuntu-20.04-jdk-11-ndk-r21e',
  'ubuntu-20.04-jdk-11-ndk-r23b',
  'ubuntu-22.04-jdk-8-ndk-r21e',
  'ubuntu-22.04-jdk-11-ndk-r21e',
  'ubuntu-22.04-jdk-11-ndk-r23b',
];
