## Workflows

This project is configured to use [EAS Workflows](https://docs.expo.dev/eas/workflows/get-started/) to automate some development and release processes. These commands are set up in [`package.json`](./package.json) and can be run using NPM scripts in your terminal.

### Previews

Run `npm run preview` to [publish a preview update](https://docs.expo.dev/eas/workflows/examples/publish-preview-update/) of your project, which can be viewed in Expo Go or in a development build.

### Development Builds

Run `npm run development-builds` to [create a development build](https://docs.expo.dev/eas/workflows/examples/create-development-builds/). Note - you'll need to follow the [Prerequisites](https://docs.expo.dev/eas/workflows/examples/create-development-builds/#prerequisites) to ensure you have the correct emulator setup on your machine.

### Production Deployments

Run `npm run deploy` to [deploy to production](https://docs.expo.dev/eas/workflows/examples/deploy-to-production/). Note - you'll need to follow the [Prerequisites](https://docs.expo.dev/eas/workflows/examples/deploy-to-production/#prerequisites) to ensure you're set up to submit to the Apple and Google stores.

## Hosting

Expo offers hosting for websites and API functions via EAS Hosting. See the [Getting Started](https://docs.expo.dev/eas/hosting/get-started/) guide to learn more.
