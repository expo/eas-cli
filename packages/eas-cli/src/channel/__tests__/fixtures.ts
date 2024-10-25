import { UpdateChannelBasicInfoFragment } from '../../graphql/generated';
import { UpdateBranchObject, UpdateChannelObject } from '../../graphql/queries/ChannelQuery';

export const testUpdateBranch1: UpdateBranchObject = {
  id: '754bf17f-efc0-46ab-8a59-a03f20e53e9b',
  name: 'wrong-channel',
  updateGroups: [
    [
      {
        id: 'bbe3e63a-f620-4603-8c4d-258f3e51590d',
        group: '16ca6dba-e63b-48b0-baa3-15a894ee9434',
        message: 'fix bug',
        createdAt: '2023-07-17T22:48:59.278Z',
        runtimeVersion: 'exposdk:48.0.0',
        platform: 'ios',
        manifestFragment:
          '{"extra":{"expoClient":{"ios":{"supportsTablet":true,"bundleIdentifier":"com.quintest113.updatestest4"},"web":{"favicon":"./assets/favicon.png"},"icon":"./assets/icon.png","name":"updates-test-4","slug":"updates-test-4","extra":{"eas":{"projectId":"789a8784-0186-4f41-8bd2-7f219291a2b8"}},"splash":{"image":"./assets/splash.png","resizeMode":"contain","backgroundColor":"#ffffff"},"android":{"package":"com.quintest113.updatestest4","adaptiveIcon":{"backgroundColor":"#ffffff","foregroundImage":"./assets/adaptive-icon.png"}},"updates":{"url":"https://u.expo.dev/789a8784-0186-4f41-8bd2-7f219291a2b8"},"version":"1.0.0","platforms":["ios","android"],"sdkVersion":"48.0.0","orientation":"portrait","runtimeVersion":{"policy":"sdkVersion"},"currentFullName":"@quintest113/updates-test-4","originalFullName":"@quintest113/updates-test-4","userInterfaceStyle":"light","assetBundlePatterns":["**/*"]}},"assets":[{"bundleKey":"7d40544b395c5949f4646f5e150fe020","fileSHA256":"LN_rjlzN55dvcBL7jM5zryIpAp7iHU8VCf7RFIccbNg","storageKey":"Pi65ns2w9xLI5G_m9aGrJ5wK5FpWcGcInSSFwnA_0aA","contentType":"image/png","fileExtension":".png"},{"bundleKey":"cdd04e13d4ec83ff0cd13ec8dabdc341","fileSHA256":"irHji01LPI9giDYxtJo9bTPHaEHzuUcCMTlb4xn90Ks","storageKey":"oJZ9JX1m8IKNDgnIqcKOo5KUFOoa_NCaxruigZu65E0","contentType":"image/png","fileExtension":".png"},{"bundleKey":"a132ecc4ba5c1517ff83c0fb321bc7fc","fileSHA256":"K3RDqaWOksoRpXW9wRWYYVpX3eMFzYznDWAmBrMCzZg","storageKey":"X3OAkUu5P_LqyKFx1bNkA_qDQFLlSjCYNAlVEaOamHE","contentType":"image/png","fileExtension":".png"},{"bundleKey":"0ea69b5077e7c4696db85dbcba75b0e1","fileSHA256":"Pd0Hc-0n4j0leJ8wFzGzrEVa2L5aonoKG4OPicbSciU","storageKey":"FwJkAbrRNahBGX1KXnTAgiiwyzENu3D7DeEzCwmInyo","contentType":"image/png","fileExtension":".png"},{"bundleKey":"f5b790e2ac193b3d41015edb3551f9b8","fileSHA256":"vCfIss7SLYKt1AAi0hxjsgOMEDceLJB6ZWjQf6gTU4k","storageKey":"GQtYm7r0G9N3WJyrymjZ26p8eNMIb7rzqwSVgGco5EU","contentType":"image/png","fileExtension":".png"},{"bundleKey":"5223c8d9b0d08b82a5670fb5f71faf78","fileSHA256":"LJXowmdeeZM1_QBGuwfb2gbLfs_1HtN5IsYwnWGcxNM","storageKey":"jeqOrdQBNY4hgl04B3wtGs8QNWMDmjvbjIMUXPtOBpw","contentType":"image/png","fileExtension":".png"},{"bundleKey":"02d5848f62ade9617cf96894727d32e7","fileSHA256":"u1-8zHOj9oxS8maH-7JbShJIq1-KEV7FXnrGpEUcR-4","storageKey":"LMUvUZZpdGFb7KqaB_l9N4TXTkFn1Pw92ws9fWDNZPw","contentType":"model/gltf-binary","fileExtension":".glb"},{"bundleKey":"6013c27e421ab23c826713af3ebec891","fileSHA256":"dutQNnvzTCS4NgwvbeMbvhro5QnW0GJUeY_4rrvlcLY","storageKey":"85KB9Jr7eqz1Jwt1mYQGRzTy6ZXyO0j7ZcaLImCbzkU","contentType":"image/jpeg","fileExtension":".jpg"}],"launchAsset":{"bundleKey":"3d0ac172fe41ab941a8c68cd7e3a17ee","fileSHA256":"jjnar-ZPrb_g0Bx5tcFfjJrP3v8HdeAlXMk__xN7I1U","storageKey":"bimf-UXq5IFH5nNHCIHdcQ2MyJwTnwDVBb-P8hr2CZw","contentType":"application/javascript","fileExtension":".bundle"}}',
        isRollBackToEmbedded: false,
        manifestPermalink: 'https://u.expo.dev/update/bbe3e63a-f620-4603-8c4d-258f3e51590d',
        gitCommitHash: 'e91c5bb733eff675dd8a3722ed5d4f885a4b10ce',
        actor: {
          __typename: 'User',
          id: '026ace2b-c1f8-4a02-818d-6b52c100bdf2',
          username: 'quintest113',
        },
        branch: {
          id: '754bf17f-efc0-46ab-8a59-a03f20e53e9b',
          name: 'wrong-channel',
          __typename: 'UpdateBranch',
        },
        codeSigningInfo: null,
        __typename: 'Update',
      },
      {
        id: 'db22401b-d321-4629-a068-21d6d1f19c02',
        group: '16ca6dba-e63b-48b0-baa3-15a894ee9434',
        message: 'fix bug',
        createdAt: '2023-07-17T22:48:59.278Z',
        runtimeVersion: 'exposdk:48.0.0',
        platform: 'android',
        manifestFragment:
          '{"extra":{"expoClient":{"ios":{"supportsTablet":true,"bundleIdentifier":"com.quintest113.updatestest4"},"web":{"favicon":"./assets/favicon.png"},"icon":"./assets/icon.png","name":"updates-test-4","slug":"updates-test-4","extra":{"eas":{"projectId":"789a8784-0186-4f41-8bd2-7f219291a2b8"}},"splash":{"image":"./assets/splash.png","resizeMode":"contain","backgroundColor":"#ffffff"},"android":{"package":"com.quintest113.updatestest4","adaptiveIcon":{"backgroundColor":"#ffffff","foregroundImage":"./assets/adaptive-icon.png"}},"updates":{"url":"https://u.expo.dev/789a8784-0186-4f41-8bd2-7f219291a2b8"},"version":"1.0.0","platforms":["ios","android"],"sdkVersion":"48.0.0","orientation":"portrait","runtimeVersion":{"policy":"sdkVersion"},"currentFullName":"@quintest113/updates-test-4","originalFullName":"@quintest113/updates-test-4","userInterfaceStyle":"light","assetBundlePatterns":["**/*"]}},"assets":[{"bundleKey":"778ffc9fe8773a878e9c30a6304784de","fileSHA256":"i2Gkx-9w3JJ1PwSUl2SC9m_UFQ7CPfx3KrZeEDc6-lU","storageKey":"idnX8z03q4vGLzhYMPaQGBADjhqvWe67_afPqJ1vGzM","contentType":"image/png","fileExtension":".png"},{"bundleKey":"376d6a4c7f622917c39feb23671ef71d","fileSHA256":"QJsG0VpGM-5viirUgoKq0M4zQ_TYyPfLhAhN5mrM54I","storageKey":"46DQ95-UdSKiRkQgt5FyXkE1FrKOT9tBZP3nS7auKlg","contentType":"image/png","fileExtension":".png"},{"bundleKey":"c79c3606a1cf168006ad3979763c7e0c","fileSHA256":"kGZm3WiTRq2iMs42ia3vkHtCV_obWT8DY40rlJf2SIQ","storageKey":"k-3xHp3vP8mR36WdccUZVPTRJKpP-zlyboWdkXCIQpQ","contentType":"image/png","fileExtension":".png"},{"bundleKey":"02bc1fa7c0313217bde2d65ccbff40c9","fileSHA256":"_6fuRbdkBbpzkhSVAI99aMneY5X0tpQdsGNGX244IyA","storageKey":"lfqeUjiWFXwowhxVDBEzxsbTOEzYxMLebljy5Bh1mpU","contentType":"image/png","fileExtension":".png"},{"bundleKey":"35ba0eaec5a4f5ed12ca16fabeae451d","fileSHA256":"hM9es7ICUPaeDkczvrTaX0F_BoKJKlrRteYlcHU8IbE","storageKey":"fMoMrsUeB5xWw_Ugn8FqGJf-M2pld2hkXKR704z0MM8","contentType":"image/png","fileExtension":".png"},{"bundleKey":"5223c8d9b0d08b82a5670fb5f71faf78","fileSHA256":"LJXowmdeeZM1_QBGuwfb2gbLfs_1HtN5IsYwnWGcxNM","storageKey":"jeqOrdQBNY4hgl04B3wtGs8QNWMDmjvbjIMUXPtOBpw","contentType":"image/png","fileExtension":".png"},{"bundleKey":"02d5848f62ade9617cf96894727d32e7","fileSHA256":"u1-8zHOj9oxS8maH-7JbShJIq1-KEV7FXnrGpEUcR-4","storageKey":"LMUvUZZpdGFb7KqaB_l9N4TXTkFn1Pw92ws9fWDNZPw","contentType":"model/gltf-binary","fileExtension":".glb"},{"bundleKey":"6013c27e421ab23c826713af3ebec891","fileSHA256":"dutQNnvzTCS4NgwvbeMbvhro5QnW0GJUeY_4rrvlcLY","storageKey":"85KB9Jr7eqz1Jwt1mYQGRzTy6ZXyO0j7ZcaLImCbzkU","contentType":"image/jpeg","fileExtension":".jpg"}],"launchAsset":{"bundleKey":"4cc2ee49988e438ac066827b809721de","fileSHA256":"ctfK72f8EdS1IQmDvJLya38RMSma16beJcMoQToZIe0","storageKey":"QdEoKuCQPvVPA71gY52wqJ9vmtV4ObnCcPE2FP4SIdo","contentType":"application/javascript","fileExtension":".bundle"}}',
        isRollBackToEmbedded: false,
        manifestPermalink: 'https://u.expo.dev/update/db22401b-d321-4629-a068-21d6d1f19c02',
        gitCommitHash: 'e91c5bb733eff675dd8a3722ed5d4f885a4b10ce',
        actor: {
          __typename: 'User',
          id: '026ace2b-c1f8-4a02-818d-6b52c100bdf2',
          username: 'quintest113',
        },
        branch: {
          id: '754bf17f-efc0-46ab-8a59-a03f20e53e9b',
          name: 'wrong-channel',
          __typename: 'UpdateBranch',
        },
        codeSigningInfo: null,
        __typename: 'Update',
      },
    ],
  ],
  __typename: 'UpdateBranch',
};

export const testUpdateBranch2: UpdateBranchObject = {
  id: '6941a8dd-5c0a-48bc-8876-f49c88ed419f',
  name: 'production',
  updateGroups: [
    [
      {
        id: 'f04aafc1-0bf5-4548-8c35-726b467e7c40',
        group: 'e40ad156-e9af-4cc2-8e9d-c7b5c328db48',
        message: 'fix bug',
        createdAt: '2023-06-23T23:37:10.004Z',
        runtimeVersion: 'exposdk:48.0.0',
        platform: 'ios',
        manifestFragment:
          '{"extra":{"expoClient":{"ios":{"supportsTablet":true,"bundleIdentifier":"com.quintest113.updatestest4"},"web":{"favicon":"./assets/favicon.png"},"icon":"./assets/icon.png","name":"updates-test-4","slug":"updates-test-4","extra":{"eas":{"projectId":"789a8784-0186-4f41-8bd2-7f219291a2b8"}},"splash":{"image":"./assets/splash.png","resizeMode":"contain","backgroundColor":"#ffffff"},"android":{"package":"com.quintest113.updatestest4","adaptiveIcon":{"backgroundColor":"#ffffff","foregroundImage":"./assets/adaptive-icon.png"}},"updates":{"url":"https://u.expo.dev/789a8784-0186-4f41-8bd2-7f219291a2b8"},"version":"1.0.0","platforms":["ios","android"],"sdkVersion":"48.0.0","orientation":"portrait","runtimeVersion":{"policy":"sdkVersion"},"currentFullName":"@quintest113/updates-test-4","originalFullName":"@quintest113/updates-test-4","userInterfaceStyle":"light","assetBundlePatterns":["**/*"]}},"assets":[{"bundleKey":"7d40544b395c5949f4646f5e150fe020","fileSHA256":"LN_rjlzN55dvcBL7jM5zryIpAp7iHU8VCf7RFIccbNg","storageKey":"Pi65ns2w9xLI5G_m9aGrJ5wK5FpWcGcInSSFwnA_0aA","contentType":"image/png","fileExtension":".png"},{"bundleKey":"cdd04e13d4ec83ff0cd13ec8dabdc341","fileSHA256":"irHji01LPI9giDYxtJo9bTPHaEHzuUcCMTlb4xn90Ks","storageKey":"oJZ9JX1m8IKNDgnIqcKOo5KUFOoa_NCaxruigZu65E0","contentType":"image/png","fileExtension":".png"},{"bundleKey":"a132ecc4ba5c1517ff83c0fb321bc7fc","fileSHA256":"K3RDqaWOksoRpXW9wRWYYVpX3eMFzYznDWAmBrMCzZg","storageKey":"X3OAkUu5P_LqyKFx1bNkA_qDQFLlSjCYNAlVEaOamHE","contentType":"image/png","fileExtension":".png"},{"bundleKey":"0ea69b5077e7c4696db85dbcba75b0e1","fileSHA256":"Pd0Hc-0n4j0leJ8wFzGzrEVa2L5aonoKG4OPicbSciU","storageKey":"FwJkAbrRNahBGX1KXnTAgiiwyzENu3D7DeEzCwmInyo","contentType":"image/png","fileExtension":".png"},{"bundleKey":"f5b790e2ac193b3d41015edb3551f9b8","fileSHA256":"vCfIss7SLYKt1AAi0hxjsgOMEDceLJB6ZWjQf6gTU4k","storageKey":"GQtYm7r0G9N3WJyrymjZ26p8eNMIb7rzqwSVgGco5EU","contentType":"image/png","fileExtension":".png"},{"bundleKey":"5223c8d9b0d08b82a5670fb5f71faf78","fileSHA256":"LJXowmdeeZM1_QBGuwfb2gbLfs_1HtN5IsYwnWGcxNM","storageKey":"jeqOrdQBNY4hgl04B3wtGs8QNWMDmjvbjIMUXPtOBpw","contentType":"image/png","fileExtension":".png"},{"bundleKey":"02d5848f62ade9617cf96894727d32e7","fileSHA256":"u1-8zHOj9oxS8maH-7JbShJIq1-KEV7FXnrGpEUcR-4","storageKey":"LMUvUZZpdGFb7KqaB_l9N4TXTkFn1Pw92ws9fWDNZPw","contentType":"model/gltf-binary","fileExtension":".glb"},{"bundleKey":"6013c27e421ab23c826713af3ebec891","fileSHA256":"dutQNnvzTCS4NgwvbeMbvhro5QnW0GJUeY_4rrvlcLY","storageKey":"85KB9Jr7eqz1Jwt1mYQGRzTy6ZXyO0j7ZcaLImCbzkU","contentType":"image/jpeg","fileExtension":".jpg"}],"launchAsset":{"bundleKey":"76ec49faddaef30ba78fe50edc5ab3d6","fileSHA256":"OLUdgP-fZI2shwGS5qlIk7nWnybL_13RJl5xR85CDBU","storageKey":"OCvI0-34zApbdo3eSGfIaQUbWdZeLeKH-nJSeedKTFs","contentType":"application/javascript","fileExtension":".bundle"}}',
        isRollBackToEmbedded: false,
        manifestPermalink: 'https://u.expo.dev/update/f04aafc1-0bf5-4548-8c35-726b467e7c40',
        gitCommitHash: 'e91c5bb733eff675dd8a3722ed5d4f885a4b10ce',
        actor: {
          __typename: 'User',
          id: '026ace2b-c1f8-4a02-818d-6b52c100bdf2',
          username: 'quintest113',
        },
        branch: {
          id: '6941a8dd-5c0a-48bc-8876-f49c88ed419f',
          name: 'production',
          __typename: 'UpdateBranch',
        },
        codeSigningInfo: null,
        __typename: 'Update',
      },
      {
        id: 'd8d15786-2727-407f-bf3e-f4bda7e397d9',
        group: 'e40ad156-e9af-4cc2-8e9d-c7b5c328db48',
        message: 'fix bug',
        createdAt: '2023-06-23T23:37:10.004Z',
        runtimeVersion: 'exposdk:48.0.0',
        platform: 'android',
        manifestFragment:
          '{"extra":{"expoClient":{"ios":{"supportsTablet":true,"bundleIdentifier":"com.quintest113.updatestest4"},"web":{"favicon":"./assets/favicon.png"},"icon":"./assets/icon.png","name":"updates-test-4","slug":"updates-test-4","extra":{"eas":{"projectId":"789a8784-0186-4f41-8bd2-7f219291a2b8"}},"splash":{"image":"./assets/splash.png","resizeMode":"contain","backgroundColor":"#ffffff"},"android":{"package":"com.quintest113.updatestest4","adaptiveIcon":{"backgroundColor":"#ffffff","foregroundImage":"./assets/adaptive-icon.png"}},"updates":{"url":"https://u.expo.dev/789a8784-0186-4f41-8bd2-7f219291a2b8"},"version":"1.0.0","platforms":["ios","android"],"sdkVersion":"48.0.0","orientation":"portrait","runtimeVersion":{"policy":"sdkVersion"},"currentFullName":"@quintest113/updates-test-4","originalFullName":"@quintest113/updates-test-4","userInterfaceStyle":"light","assetBundlePatterns":["**/*"]}},"assets":[{"bundleKey":"778ffc9fe8773a878e9c30a6304784de","fileSHA256":"i2Gkx-9w3JJ1PwSUl2SC9m_UFQ7CPfx3KrZeEDc6-lU","storageKey":"idnX8z03q4vGLzhYMPaQGBADjhqvWe67_afPqJ1vGzM","contentType":"image/png","fileExtension":".png"},{"bundleKey":"376d6a4c7f622917c39feb23671ef71d","fileSHA256":"QJsG0VpGM-5viirUgoKq0M4zQ_TYyPfLhAhN5mrM54I","storageKey":"46DQ95-UdSKiRkQgt5FyXkE1FrKOT9tBZP3nS7auKlg","contentType":"image/png","fileExtension":".png"},{"bundleKey":"c79c3606a1cf168006ad3979763c7e0c","fileSHA256":"kGZm3WiTRq2iMs42ia3vkHtCV_obWT8DY40rlJf2SIQ","storageKey":"k-3xHp3vP8mR36WdccUZVPTRJKpP-zlyboWdkXCIQpQ","contentType":"image/png","fileExtension":".png"},{"bundleKey":"02bc1fa7c0313217bde2d65ccbff40c9","fileSHA256":"_6fuRbdkBbpzkhSVAI99aMneY5X0tpQdsGNGX244IyA","storageKey":"lfqeUjiWFXwowhxVDBEzxsbTOEzYxMLebljy5Bh1mpU","contentType":"image/png","fileExtension":".png"},{"bundleKey":"35ba0eaec5a4f5ed12ca16fabeae451d","fileSHA256":"hM9es7ICUPaeDkczvrTaX0F_BoKJKlrRteYlcHU8IbE","storageKey":"fMoMrsUeB5xWw_Ugn8FqGJf-M2pld2hkXKR704z0MM8","contentType":"image/png","fileExtension":".png"},{"bundleKey":"5223c8d9b0d08b82a5670fb5f71faf78","fileSHA256":"LJXowmdeeZM1_QBGuwfb2gbLfs_1HtN5IsYwnWGcxNM","storageKey":"jeqOrdQBNY4hgl04B3wtGs8QNWMDmjvbjIMUXPtOBpw","contentType":"image/png","fileExtension":".png"},{"bundleKey":"02d5848f62ade9617cf96894727d32e7","fileSHA256":"u1-8zHOj9oxS8maH-7JbShJIq1-KEV7FXnrGpEUcR-4","storageKey":"LMUvUZZpdGFb7KqaB_l9N4TXTkFn1Pw92ws9fWDNZPw","contentType":"model/gltf-binary","fileExtension":".glb"},{"bundleKey":"6013c27e421ab23c826713af3ebec891","fileSHA256":"dutQNnvzTCS4NgwvbeMbvhro5QnW0GJUeY_4rrvlcLY","storageKey":"85KB9Jr7eqz1Jwt1mYQGRzTy6ZXyO0j7ZcaLImCbzkU","contentType":"image/jpeg","fileExtension":".jpg"}],"launchAsset":{"bundleKey":"f4c6981626dbabcf51078d07a1611f4e","fileSHA256":"q-k1hSWl49aXpSg4jOSaVVnYFSFL6xf7HVl_TQE-ObM","storageKey":"FwK1PaZqtpL0QZIgaHsxU1AV93JhMdu9K1wZizXROAc","contentType":"application/javascript","fileExtension":".bundle"}}',
        isRollBackToEmbedded: false,
        manifestPermalink: 'https://u.expo.dev/update/d8d15786-2727-407f-bf3e-f4bda7e397d9',
        gitCommitHash: 'e91c5bb733eff675dd8a3722ed5d4f885a4b10ce',
        actor: {
          __typename: 'User',
          id: '026ace2b-c1f8-4a02-818d-6b52c100bdf2',
          username: 'quintest113',
        },
        branch: {
          id: '6941a8dd-5c0a-48bc-8876-f49c88ed419f',
          name: 'production',
          __typename: 'UpdateBranch',
        },
        codeSigningInfo: null,
        __typename: 'Update',
      },
    ],
  ],
  __typename: 'UpdateBranch',
};
export const testChannelObject: UpdateChannelObject = {
  id: '9309afc2-9752-40db-8ef7-4abc10744c61',
  name: 'production',
  createdAt: '2023-05-16T21:26:16.946Z',
  updatedAt: '2023-05-16T21:26:16.946Z',
  branchMapping:
    '{"data":[{"branchId":"754bf17f-efc0-46ab-8a59-a03f20e53e9b","branchMappingLogic":{"operand":0.15,"clientKey":"rolloutToken","branchMappingOperator":"hash_lt"}},{"branchId":"6941a8dd-5c0a-48bc-8876-f49c88ed419f","branchMappingLogic":"true"}],"version":0}',
  updateBranches: [testUpdateBranch1, testUpdateBranch2],
  isPaused: false,
  __typename: 'UpdateChannel',
};

export const testBasicChannelInfo: UpdateChannelBasicInfoFragment = {
  id: '9309afc2-9752-40db-8ef7-4abc10744c61',
  name: 'production',
  branchMapping:
    '{"data":[{"branchId":"754bf17f-efc0-46ab-8a59-a03f20e53e9b","branchMappingLogic":{"operand":0.1,"clientKey":"rolloutToken","branchMappingOperator":"hash_lt"}},{"branchId":"6941a8dd-5c0a-48bc-8876-f49c88ed419f","branchMappingLogic":"true"}],"version":0}',
  __typename: 'UpdateChannel',
};

export const testBasicChannelInfo2: UpdateChannelBasicInfoFragment = {
  id: '9d5c7bf0-d52d-474c-9140-c1bad7f0de9d',
  name: 'staging',
  branchMapping:
    '{"data":[{"branchId":"d7d68e32-d9c9-4a8d-8d1b-21e53100a5e8","branchMappingLogic":{"operand":0.1,"clientKey":"rolloutToken","branchMappingOperator":"hash_lt"}},{"branchId":"f9f708c2-0c91-4360-b2a4-0b61834aef4a","branchMappingLogic":"true"}],"version":0}',
  __typename: 'UpdateChannel',
};
