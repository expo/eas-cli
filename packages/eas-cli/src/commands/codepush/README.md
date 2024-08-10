This set of commands does its best to map appcenter codepush commands to EAS update. Generally it works by mapping codepush deployments as EAS channels. Each release on a deployment corresponds to a branch with one update group. That release can be rolled out against the existing release on the deployment. Release history doesn't work too well, but that's ok I hope.

deployment add - channel create
deployment clear - channel edit, create empty branch, point to blank branch
deployment history - branch view of current branch associated with the channel
deployment list - channel list
deployment remove - channel delete
deployment rename - not possible, throw error

release-react: creates new branch, rolls the channel out to N % on that branch.
  --use-hermes: not supported
  --extra-hermes-flag: not supported
  --extra-bundler-option: not supported
  --target-binary-version -> not supported, inferred runtime version
  --output-dir -> same as eas update output dir
  --sourcemap-output-dir -> not supported
  --sourcemap-output -> not supported
  --xcode-target-name -> not supported, use target-binary-version
  --build-configuration-name -> not supported, use target-binary-version
  --plist-file-prefix -> not supported
  --xcode-project-file -> not supported
  --plist-file -> not supported
  --pod-file -> not supported
  --gradle-file -> not supported, use target-binary-version
  --entry-file -> not supported, same as eas update
  --development -> not supported, think this is same as eas update
  --bundle-name -> not supported
  --rollout -> set N % to N
  --disable-duplicate-release-error -> no idea
  --private-key-path -> same as eas update
  --mandatory -> not supported for now
  --disabled -> set N % to 0
  --description -> message
  --deployment-name -> channel to put the new branch on

promote: copies latest update on "latest branch" on channel to "latest branch" on other channel. it does this by creating a new branch with the update and pointing the channel to that new branch according to rollout or 100% if no rollout supplied.

rollback: sets the rollout percentage of branch on channel to 0 (i.e. points to prev branch) and republishes the latest update on the prev branch to itself

patch: only update the rollout percentage