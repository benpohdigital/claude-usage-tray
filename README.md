# Claude Usage Tray

A small macOS menu bar app. It shows your Claude plan usage (the 5-hour session) as a bar, the same figure as Settings › Usage in the Claude app. Click the bar to see the session, weekly limits, reset times and settings.

Personal tool: macOS on Apple Silicon only, one user.

## Important: the endpoint is not documented

The app reads usage from `GET https://api.anthropic.com/api/oauth/usage`, the endpoint Claude Code uses for `/usage`. Anthropic does not document it and can change or remove it at any time. If the app shows "Usage data not available", the response format has probably changed.

## Requirements

- You are signed in to **Claude Code** on this Mac (`claude`, then `/login`). The app uses Claude Code's login. It has no sign-in of its own.
- Node.js 20 or newer, to build.

## Install

```sh
npm install
npm start          # run in development
npm run dist       # build dist/Claude Usage Tray-<version>-arm64.dmg
```

Open the `.dmg` and drag the app to Applications. The app is not code-signed, so the first time, right-click the app and choose **Open**, then **Open** again. If macOS still blocks it, go to System Settings › Privacy & Security and click **Open Anyway**.

Turn on **Start at login** in the panel's Settings if you want it to start automatically.

## The Keychain prompt

Claude Code keeps its login in the macOS Keychain, under `Claude Code-credentials`. The app reads it with:

```sh
security find-generic-password -s "Claude Code-credentials" -w
```

The first time, macOS can ask if `security` may use this Keychain item. Click **Always Allow** so the prompt does not come back on every poll. If you click **Deny**, the panel says "Claude Code not signed in".

The token stays in the app's main process. The app sends it only to `api.anthropic.com`. It never shows it to the panel and never writes it to disk or logs. The app does not refresh the token. If the token has expired, the panel says "Sign in to Claude Code again". Use Claude Code once (or run `/login`) and the app picks up the new token on the next poll. The app never calls the Messages API, so checking usage uses no tokens.

## What it does

- **Menu bar:** a 22 × 8 pt bar filled to the 5-hour usage. It is a monochrome template image, so macOS tints it to match your other menu bar icons. It is faint when there is no data. A dot shows when any alert is active. Amber and red appear in the panel only. You can show the percent as text with "Show percent in menu bar".
- **Panel:** shows the current session (with "Resets in …"), weekly usage for all models, and per-model weekly usage when the API returns it. It also shows extra usage when present and a weekly pace warning. Reset times are in your local time.
- **Polling:** every 5 minutes, and when you open the panel if the data is older than 1 minute. It never polls more than once a minute. Polling stops while the Mac sleeps and runs once after it wakes. On HTTP 429 or 5xx errors it keeps the last data and backs off (10 min, then 15 min). When offline it keeps the last data and retries every 2 minutes.
- **Alerts:** macOS notifications at 75% and 90% (you can change both) for the session and weekly windows, and at 100% for any window. Each one is sent once per window and resets when a new window starts. The sent state is kept in `~/Library/Application Support/Claude Usage Tray/alerts.json`. Clicking a notification opens the panel.

## Files

| File | Purpose |
| --- | --- |
| `main.js` | App start, tray, panel window, polling, settings, notifications |
| `usage.js` | Keychain read, API call, response parsing |
| `alerts.js` | Alert thresholds, sent-alert state, weekly pace check |
| `icon.js` | Draws the menu bar bar image |
| `preload.js` | The panel's only bridge (`window.usageApi`) |
| `panel/` | Panel HTML, CSS and JS |

Settings are kept in `~/Library/Application Support/Claude Usage Tray/settings.json`.
