/** One Android resource value in a runtime resource overlay. */
export type AndroidResourceOverlayValue = {
  type: 'dimen' | 'string';
  name: string;
  value: string;
};

/** Values for one target package, such as `android` (framework) or `com.android.systemui`. */
export type AndroidResourceOverlay = {
  targetPackage: 'android' | 'com.android.systemui';
  values: AndroidResourceOverlayValue[];
};

/**
 * Values that make an emulator device profile match the real device. The emulator's profile
 * overlays (`com.android.internal.emulation.<profile>`) set the cutout and the corners, but some of
 * their values are from the device launch or are missing.
 */
export type AndroidEmulatorDeviceProfileCorrection = {
  /** Where the values come from. */
  source: string;
  overlays: AndroidResourceOverlay[];
};

// Outline of the Pixel 9 display, from the same overlay as the other framework values.
const PIXEL_9_MAIN_DISPLAY_SHAPE =
  'm 885,0 h 4 6c 2,0 4,0 5,0 4,0 7,0 11,0 2,0 3,0 5,0 3,0 5,0 8,0 3,0 7,0 10,0 2,0 3,0 5,0 3,0 6,0 9,1 2,0 5,1 7,1 3,0 6,1 9,1 2,0 4,1 6,1 4,1 7,2 11,3 4,1 7,2 11,4 2,1 5,2 7,3 4,2 8,4 11,6 4,2 8,5 12,8 2,2 4,3 6,5 2,2 5,4 7,6 3,2 5,5 7,7 3,3 5,6 8,9 2,3 4,6 6,9 3,4 5,9 8,13 1,2 2,5 3,7 1,3 3,6 4,9 1,4 2,7 3,11 1,4 2,7 2,11 1,3 1,6 2,10 1,4 1,7 1,11 0,5 1,11 1,16 0,4 0,8 0,13 0,5 0,11 0,16 0,2 0,5 0,7v 7 2038 4c 0,4 0,7 0,11 0,3 0,7 0,10 0,3 0,6 0,9 0,4 0,7 0,11 0,3 0,7 -1,10 0,4 -1,7 -1,11 0,3 -1,6 -2,10 -1,4 -2,7 -2,11 -1,3 -2,6 -3,10 -1,3 -2,6 -4,9 -1,4 -3,7 -5,10 -2,5 -5,9 -8,13 -2,3 -4,6 -6,8 -2,2 -4,5 -6,7 -4,4 -9,9 -13,13 -3,3 -6,5 -9,7 -2,2 -5,3 -8,5 -4,2 -7,4 -11,6 -3,1 -5,3 -8,4 -2,1 -3,1 -5,2 -2,1 -5,2 -7,2 -3,1 -6,2 -10,3 -9,2 -19,3 -28,4C 931,2424 919,2424 907,2424c -4,0 -7,0 -11,0 -4,0 -8,0 -11,0 0,0 -463,0 -694,0 -5,0 -9,0 -14,0 -1,0 -3,0 -4,0 -3,0 -6,0 -9,0 -2,0 -4,0 -6,0 -4,0 -7,0 -11,0 -2,0 -4,0 -6,0 -3,0 -6,0 -10,-1 -4,0 -8,-1 -12,-2 -4,-1 -7,-1 -11,-2 -3,-1 -6,-1 -8,-2 -6,-2 -13,-5 -19,-7 -3,-1 -5,-3 -8,-4 -5,-3 -10,-6 -14,-9 -3,-2 -6,-5 -9,-7 -4,-4 -8,-8 -12,-12 -2,-2 -4,-5 -6,-7 -2,-3 -4,-6 -6,-8 -3,-5 -7,-11 -9,-17 -2,-5 -4,-9 -6,-14 -2,-6 -4,-12 -5,-18 -1,-5 -2,-10 -3,-16 -1,-6 -1,-12 -2,-18 0,-6 0,-12 -1,-18 0,-4 0,-8 0,-12 0,-4 0,-8 0,-12 0,-2 0,-5 0,-7C 0,1552 0,196 0,196v -7 -14c 0,-1 0,-2 0,-3 0,-6 0,-11 0,-17 0,-4 0,-8 1,-12 0,-5 1,-11 2,-16 1,-5 2,-11 3,-16 1,-6 3,-11 5,-17 1,-4 3,-7 4,-11 1,-2 2,-5 3,-7 3,-5 5,-10 8,-14 2,-4 5,-7 8,-10 3,-4 6,-7 10,-11 4,-4 8,-8 13,-11 3,-2 6,-4 9,-6 5,-3 10,-6 15,-8 4,-2 8,-4 13,-5 5,-2 11,-4 17,-5 5,-1 10,-2 16,-3 5,-1 11,-1 16,-2C 152,0 160,0 169,0c 7,0 14,0 22,0 2,0 5,0 7,0z';

export const ANDROID_EMULATOR_DEVICE_PROFILE_CORRECTIONS: Readonly<
  Partial<Record<string, AndroidEmulatorDeviceProfileCorrection>>
> = {
  pixel_9: {
    source:
      'Pixel 9 (tokay) OTA cp4a.261105.040.a1: vendor/overlay/framework-res__tokay__auto_generated_rro_vendor.apk, vendor/overlay/SystemUIGoogle__tokay__auto_generated_rro_vendor.apk, and system_ext/priv-app/SystemUIGoogle/SystemUIGoogle.apk',
    overlays: [
      {
        targetPackage: 'android',
        values: [
          // The emulator has the launch value, 52 dp. Android 15 QPR1 made the status bar taller.
          { type: 'dimen', name: 'status_bar_height_portrait', value: '66dp' },
          { type: 'dimen', name: 'status_bar_height_landscape', value: '24dp' },
          // The status bar height follows this rectangle; the emulator has `v 141.5`.
          {
            type: 'string',
            name: 'config_mainBuiltInDisplayCutoutRectApproximation',
            value: 'm 484.5,0 h 110 v 173 h -110 z @left',
          },
          // Keeps the status bar content clear of the rounded corners; the emulator has 0.
          { type: 'dimen', name: 'rounded_corner_content_padding', value: '70px' },
          { type: 'dimen', name: 'rounded_corner_radius_top_adjustment', value: '5px' },
          { type: 'dimen', name: 'rounded_corner_radius_bottom_adjustment', value: '4px' },
          { type: 'string', name: 'config_mainDisplayShape', value: PIXEL_9_MAIN_DISPLAY_SHAPE },
          { type: 'dimen', name: 'navigation_bar_gesture_larger_height', value: '110dp' },
          { type: 'dimen', name: 'quick_qs_offset_height', value: '171px' },
        ],
      },
      {
        targetPackage: 'com.android.systemui',
        values: [
          { type: 'dimen', name: 'status_bar_padding_top', value: '1dp' },
          { type: 'dimen', name: 'keyguard_carrier_text_margin', value: '70px' },
          // From SystemUIGoogle; AOSP System UI on the emulator uses 12 dp.
          { type: 'dimen', name: 'status_bar_clock_starting_padding', value: '4dp' },
        ],
      },
    ],
  },
};
