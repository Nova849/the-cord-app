LiveKit Desktop Test App
========================

This repo contains a simple Electron client for testing LiveKit desktop
screen share + audio. Follow these steps to run it locally.

Prereqs
-------
- Node.js 18+ installed
- A running LiveKit server reachable from this machine


Generating a test token
-----------------------
From the repo root:
In admin Powershell
  node generateToken.js

Paste the JWT into the app and click Join.

Auto updates (GitHub Releases)
------------------------------
Auto updates only work in packaged builds (the installer), not when running
`npx electron .`.

1) Bump the version in livekit-desktop/package.json (e.g. 1.0.1).
2) Build the installer:
   cd livekit-desktop
   npm run dist
3) Create a GitHub Release (tag like v1.0.1) and upload these files from
   livekit-desktop/dist:
   - The Cord Setup x.y.z.exe
   - latest.yml
   - The Cord Setup x.y.z.exe.blockmap
4) In the app Connection > Services, set Update feed URL to:
   https://github.com/OWNER/REPO/releases/latest/download/
5) Reopen the app and click "Check updates".

Notes
-----
- Screen share source can be selected from the Source dropdown.
- Stream controls are in the left panel.
- If you change tokens/permissions, re-generate the JWT.


How to increase the build number
---------------------------------
cd C:\Users\cwill\Desktop\LiveKit\the-cord-app\LiveKit\livekit-desktop
npm version 1.0.1 --no-git-tag-version
npm run dist
