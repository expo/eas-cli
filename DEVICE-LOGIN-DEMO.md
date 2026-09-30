# EAS device login: local demo and agent lifecycle

## Recommendation

Make device login resumable across CLI processes. An agent starts login, sends the user a link and code, and ends its chat turn. The user approves in their browser and replies with the displayed number. A new CLI process submits that number and saves the normal Expo session.

The browser can advance the server state while no CLI process is running. No daemon, loopback callback, terminal attachment, webhook, or additional backend is needed. The agent host still has to start the next turn when the user replies; the CLI cannot wake a chat agent by itself.

## Run the local build

Branch: `eiiot/device-login` in `expo/eas-cli`, based on `origin/main` at `417996a`.

```sh
git clone --branch eiiot/device-login https://github.com/expo/eas-cli.git eas-cli-device-login
cd eas-cli-device-login
yarn install --immutable
yarn lerna run build --scope eas-cli --include-dependencies
alias easd="$PWD/packages/eas-cli/bin/run"
easd login --device
```

This prints a verification link and code, waits for approval, and presents Expo's number picker. It also prints a request ID for resuming after exiting. It never launches a browser on the remote machine.

For a demo that runs immediately without server deployment or a real account:

```sh
node packages/eas-cli/scripts/demo-device-login.cjs
```

This uses the **real built CLI** in a fresh child process for each invocation, closed stdin, simulated HTTP responses, and an isolated temporary home. The browser/user steps are simulated and clearly labeled. It checks the saved session, cleanup, wrong-number failure, and argument/non-TTY validation. It does not authenticate against Expo or change your existing login.

To rebuild:

```sh
yarn install --immutable
yarn lerna run build --scope eas-cli --include-dependencies
```

## Chat agent flow

### Turn 1: start, send instructions, stop

```sh
easd login --device --json
```

Returns one JSON object and exits:

```json
{
  "request_id": "<opaque local UUID>",
  "status": "authorization_pending",
  "verification_uri": "https://expo.dev/oauth/device",
  "verification_uri_complete": "https://expo.dev/oauth/device?user_code=BCDF-GHJK",
  "user_code": "BCDF-GHJK",
  "expires_at": "<ISO timestamp>",
  "retry_after": 5
}
```

Suggested chat message: “Open this Expo link and confirm code **BCDF-GHJK**. After approving, reply here with the number Expo shows.”

Remember `request_id` in the task/conversation state. The UUID is a local lookup handle, not a bearer credential. The grant's secret stays in a private file on the machine. End the turn; there is no process to keep alive and no need to poll while waiting for the user.

### Turn 2: submit the user's number

```sh
easd login --device --json --resume REQUEST_ID --match 42
```

Successful result:

```json
{
  "request_id": "<same UUID>",
  "status": "authenticated",
  "username": "the-user"
}
```

The session is saved using the existing SessionManager and shared Expo state format. Continue the original task; `easd whoami` works normally. Completing an explicit device login switches the machine's active account to the approved account. Starting a request alone does not replace it.

If the user says “done” without a number, inspect the state:

```sh
easd login --device --json --resume REQUEST_ID
```

When the browser has approved, this returns `matching_required` and the three `match_options`. Ask the user which number their browser displays. Pass that value verbatim with `--match`; never guess, cycle through the choices, or obtain the number by controlling the user's browser.

### Result handling

| Status                  | Agent action                                                                                                                                                                                        |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `authorization_pending` | Wait for the user to finish browser approval. If a number was already supplied, wait `retry_after` seconds and resume with the same number. This status can also mean the next poll is not due yet. |
| `matching_required`     | Ask for the number shown in the user's browser; choices are in `match_options`.                                                                                                                     |
| `slow_down`             | Wait at least `retry_after` seconds before another invocation; retain any user-supplied number.                                                                                                     |
| `authenticated`         | Continue the task as `username`.                                                                                                                                                                    |
| `access_denied`         | Stop. Approval was denied or the submitted number was wrong. A new login is required.                                                                                                               |
| `expired_token`         | Start a fresh login and send the new code.                                                                                                                                                          |
| `invalid_grant`         | Start again: the server no longer accepts this request, including an already-consumed grant.                                                                                                        |

In this prototype, `--json` explicitly means **one step with no prompts or waiting**. Exit 0 means the step ran; inspect `status` to distinguish waiting from authenticated. Terminal grant failures print JSON and exit 1. Argument, network, and local-state errors use the existing CLI's nonzero exit/stderr error convention. Resume retryable failures with the same request ID. There is no automatic retry of number submissions.

Without `--json`, `--device` is interactive and polls until completion or expiration. Closed stdin produces a helpful error directing agents to `--json`. `--sso` and `--device` are mutually exclusive; any SSO handling in device mode happens on Expo's website. `--device` takes precedence over the default `--browser` setting.

## Existing paradigms

| Program                                                                                                                                                                                                                     | Relevant behavior                                                                                      | What to borrow                                                                                                            |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| [GitHub CLI](https://cli.github.com/manual/gh_auth_login)                                                                                                                                                                   | Browser login, one-time code/clipboard support, normal credentials saved after login.                  | Keep browser approval familiar and make completion persist a normal CLI session.                                          |
| [Wrangler](https://developers.cloudflare.com/workers/wrangler/commands/general/)                                                                                                                                            | Explicit `login --device`, with `--browser=false` for a remote machine; displays a URL/code and polls. | Use an explicit device flag and avoid opening a remote browser.                                                           |
| [Vercel](https://vercel.com/changelog/new-vercel-cli-login-flow)                                                                                                                                                            | OAuth device authorization usable from another browser/device, with approval details shown on the web. | Let the website handle identity and approval.                                                                             |
| [AWS SSO login](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-sso.html)                                                                                                                                    | `--use-device-code` supports a browser on a different device.                                          | Device flow is an established remote-login option.                                                                        |
| AWS [start-device-authorization](https://docs.aws.amazon.com/cli/latest/reference/sso-oidc/start-device-authorization.html) and [create-token](https://docs.aws.amazon.com/cli/latest/reference/sso-oidc/create-token.html) | Separate CLI operations initiate a device grant and exchange it.                                       | Split start and continuation at a durable boundary. EAS can hide the private device credential behind a local request ID. |

The saved request ID and one-step JSON interface are this demo's proposed agent UX, not a claim that the other products expose those exact flags. Expo's number matching is an additional step layered on its device grant.

## Implementation and verification

- `packages/eas-cli/src/commands/account/login.ts`: flags, interactive picker, and JSON step output.
- `packages/eas-cli/src/user/deviceLogin.ts`: existing REST endpoints, response validation, durable state, polling deadlines, and token exchange.
- `packages/eas-cli/src/user/SessionManager.ts`: install the device session using the existing account/session format and clear the cached actor.
- `packages/eas-cli/src/user/__tests__/deviceLogin-test.ts`: protocol and persistence tests, alongside existing SessionManager regression tests.
- `packages/eas-cli/scripts/demo-device-login.cjs`: process-level offline demonstration.

Private requests are stored alongside Expo's existing state in `device-login/UUID.json` (file mode 0600, new directory mode 0700). Writes are atomic, requests are bound to the API environment, and poll deadlines survive restarts. Completion and terminal failure remove the private request. Expired abandoned requests are removed when resumed. A successfully returned session secret is saved before user lookup/session installation, allowing recovery if those later operations fail.

Verification commands:

```sh
yarn workspace eas-cli test src/user/__tests__/deviceLogin-test.ts src/user/__tests__/SessionManager-test.ts --runInBand --watchman=false
yarn workspace eas-cli typecheck
node packages/eas-cli/scripts/demo-device-login.cjs
```

## Deployment and practical limits

The [Universe grant configuration PR](https://github.com/expo/universe/pull/31664) is merged and the production grant is now live. A real browser login completed successfully across separate chat turns and CLI processes: the user approved in their browser, supplied the displayed number in chat, and a fresh CLI process returned `authenticated` for the approved account. A subsequent `whoami` command independently confirmed the saved session. Earlier production and staging checks rejected the grant before deployment; staging has not been rechecked. No additional server implementation was required by this prototype.

The saved state must remain available to subsequent tool calls on the same machine/user/API environment. A disposable filesystem needs host-level persistence or a new login. Grants expire on the server, so an absent user needs a new code later. The agent host must route the user's reply to the waiting task and preserve the request ID.

The existing server consumes a grant once. If the successful token response is lost in transit, or the CLI is killed before saving it, resumption may return `invalid_grant`; start again. Exact recovery from that window would require a server change. The demo handles ordinary single-process interruption and rejects active concurrent resumes; it is intended for one agent resuming each request, not multiple agents racing to recover the same stale lock. Abandoned request cleanup and stronger concurrent recovery are follow-ups before general release.
