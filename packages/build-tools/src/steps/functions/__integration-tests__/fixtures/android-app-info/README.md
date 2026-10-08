# Android app-info fixtures

`app.apk` (639 bytes) and `app.aab` (766 bytes) contain the package
`com.example.app`. They are unsigned and contain no code or resources. They test
manifest inspection, not installation. The AAB passes `bundletool validate`.

Generated with AAPT2 from Android build-tools 36.0.0, Android platform 36,
and bundletool 1.18.3. Run these commands from this directory to regenerate:

```sh
work_dir=$(mktemp -d)
aapt2 link --manifest AndroidManifest.xml \
  -I "$ANDROID_HOME/platforms/android-36/android.jar" -o app.apk
aapt2 link --proto-format --manifest AndroidManifest.xml \
  -I "$ANDROID_HOME/platforms/android-36/android.jar" -o "$work_dir/proto.apk"
python3 - "$work_dir" <<'PY'
import pathlib
import sys
import zipfile

work_dir = pathlib.Path(sys.argv[1])
with zipfile.ZipFile(work_dir / 'proto.apk') as src:
    with zipfile.ZipFile(work_dir / 'base.zip', 'w', zipfile.ZIP_DEFLATED) as dst:
        for name in src.namelist():
            target = 'manifest/' + name if name == 'AndroidManifest.xml' else name
            dst.writestr(target, src.read(name))
PY
bundletool build-bundle --modules="$work_dir/base.zip" --output=app.aab --overwrite
bundletool validate --bundle=app.aab
rm -rf "$work_dir"
```

The `invalid-manifest-*.zip` fixtures contain one empty entry:
`AndroidManifest.xml` for APK and `BundleConfig.pb` for AAB. They exercise errors
from the real native tools after archive type detection.

Run from the repository root with `aapt2`, `bundletool`, and Java on `PATH`:

```sh
yarn workspace @expo/build-tools jest-integration readAndroidAppInfo --runInBand
```

These tests require the real tools and fail if they are unavailable. They are
outside the unit-test suite, which does not provide these dependencies.
