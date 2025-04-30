# eas-build-cache-provider

A build cache provider plugin for the Expo CLI

To use the EAS remote build provider plugin, install the `eas-build-cache-provider` package as a developer dependency:

```bash
npm install --save-dev eas-build-cache-provider
```

Then, update your **app.json** to include the `remoteBuildCache` property and its provider under `experiments`:

```json
{
  "expo": {
    ...
    "experiments": {
      "remoteBuildCache": {
        "provider": "eas-build-cache-provider"
      }
    }
  }
}
```
