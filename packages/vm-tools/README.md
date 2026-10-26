# @expo/vm-tools

A startup script loader for macOS VMs.

## Install

```sh
bunx @expo/vm-tools@latest install
```

Installs a per-user launchd agent and a standalone runner. The agent starts at the next GUI login;
installation does not load it or run a script. Automatic GUI login is required, and the Node
executable used for installation must remain available.

## Startup script

At login, vm-tools waits for `/Volumes/My Shared Files/expo-startup/startup.sh` and runs it with
`/bin/bash` once per VM boot. Put the file in the VM or provide it through a shared directory.
The script does not need executable permission.

The runner waits for the script to exit and returns its exit status. Failed scripts are not
restarted. The script owns its environment, processes and cleanup; use `exec` for a foreground
command so termination signals reach it.

Output is written to `~/Library/Logs/vm-tools.log`.
