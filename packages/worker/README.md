# Turtle Worker

<h3 align=center>
 <img src="./assets/turtle-workers.png">
</h3>

Turtle Worker is a service running on every worker VM or pod. It exposes a WebSocket server to communicate with [Turtle Launcher](/src/services/launcher). The service is basically a wrapper for @expo/build-tools library. It receives a build request and handles the actual build of the React Native project.

## WebSocket messages

There are a couple of message types that could be exchanged between a launcher and a worker, definition of those messages are [here](/src/libs/turtle-common/src/messages.ts).

Communication between worker and launcher starts with `state-query` message (`launcher -> worker`) and worker responds with `state-response`
that contains the current state of a worker. The next steps depend on the state of the worker:

- if this was a new instance of the worker then `state-response` message contained `"status": "new"` and the launcher will send `dispatch` method that should start a new build on the worker.
- if this happened during the recovery process and the build was already finished(either success or failure), then `state-response` contained information about the build result and launcher will send `close` message.
- if this happened during the recovery process and the build is still in progress, then `state-response` contained `"status": "in-progress"` and the launcher does not take any actions.

When the build is finished worker sends `success` or `error` messages with information about build results and the launcher will respond with `close` message that initiates a gracefull shutdown of a vm/pod.
If for some reason the launcher is down when the build has finished then the new launcher instance will attempt to recover that build as described above.

## Development

- Run `cp ./.direnv/local/.envrc.example ./.direnv/local/.envrc` and fill out the new file with your secrets.
- Run `yarn` (if you haven't run it in the root dir of the repo) and then `yarn start`.
- If you made a change in packages from directory `libs`, type `rs` in the console and press ENTER (or `CTRL+C`, `UP`, `ENTER`).

## Deployment

The worker code is distributed via GCS bucket and every pod/vm installs it as part of it's startup or configuration steps. Archive uploaded to GCS bucket contain version of worker source from the repository, but all other libraries that worker depends on are downloaded from npm.

### Worker code

- For every commit on main Github Actions job creates archive with worker code and node-modules. It will create two archives for every platform `worker-{{platform}}-{{hash}}` and `worker-{{platform}}-staging`.
- Deployment to production is guarded with `approve` step and it creating copy of `worker-{{platform}}-staging` under `worker-{{platform}}-production`.

#### Docker image

Github action builds a docker image for every PR with any change in `infra/eas-build-worker-images/android/{{ imageName }}`, after that image is pushed to docker registry hosted on gcloud.

### VM template

Github action builds a new vm template for every PR with any change in `infra/eas-build-worker-images/ios/{{ templateName }}`.
