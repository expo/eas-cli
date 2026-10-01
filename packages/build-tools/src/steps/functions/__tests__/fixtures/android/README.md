# Android submission fixtures

`app.apk` and `app.aab` contain the manifest in `AndroidManifest.xml`. They have
package `dev.expo.submitfixture` and version code 42. They contain no app code
and are not intended for store submission.

The fixtures were made with Android SDK Build Tools 36.0.0 (`aapt2 link`) and
bundletool 1.18.3. For the AAB, compile the manifest with `aapt2 link
--proto-format`, place it at `manifest/AndroidManifest.xml` in a base module ZIP,
and run `bundletool build-bundle --modules=base.zip --output=app.aab`.

Unit tests inspect the real ZIP files and use recorded manifest command output.
The fixture package can also be checked locally with `aapt2 dump badging app.apk`
and `bundletool dump manifest --bundle app.aab --xpath /manifest/@package`.
