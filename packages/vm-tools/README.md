# @expo/vm-tools

Run a startup script supplied when creating a guest VM.

```sh
bunx @expo/vm-tools@latest install
```

Installation copies a standalone daemon and a small Aqua LaunchAgent into the guest user's home.
It does not load the agent or run a startup script. The LaunchAgent uses the guest Node executable that ran installation; it must remain available.
Automatic GUI login is required. At login, the daemon waits for
`/Volumes/My Shared Files/expo-startup/startup.sh` and runs it with `/bin/bash` once per guest boot.
The script does not need executable permission. Anka supplies its directory as a read-only mount
before starting Tart.

The daemon waits for the script to exit and returns its exit status. It does not restart failed
scripts or interpret workload configuration, environment sidecars, or readiness. The script owns
its environment, processes, and cleanup; use `exec` for a foreground workload so termination signals
reach it. The LaunchAgent has `KeepAlive=false`.

Files use inherited OS permissions. vm-tools does not set a process umask or explicit file modes.

Run `corepack yarn workspace @expo/vm-tools test --runInBand`, `typecheck`, and `build`.
