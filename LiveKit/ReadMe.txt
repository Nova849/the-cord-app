The Cord (LiveKit Desktop)
==========================

Electron client for LiveKit screen share + voice + chat. Designed to connect
to remote public services (LiveKit, chat server, presence server). The app
does not run local servers.

Project layout
--------------
- LiveKit/livekit-desktop   Electron app (this is what you run/build)
- LiveKit/generateToken.js  JWT helper (local dev/testing)
- presenceServer/           Optional presence server (runs on your server)
- chatServer/               Optional chat server (runs on your server)

Requirements
------------
- Node.js 18+
- A reachable LiveKit server
- A JWT for the room (see below)

Run locally (dev)
-----------------
From the repo root:
  cd LiveKit/livekit-desktop
  npm install
  npx electron .

Generate a test JWT
-------------------
From the repo root (Admin PowerShell):
  cd LiveKit
  node generateToken.js

Paste the JWT into the app and click Join.

Connection + Services fields
----------------------------
In the app (Connection > Services):
- Server URL: your LiveKit URL (ws:// or wss://)
- JWT token: paste the token
- Chat server URL: optional, remote service
- Presence server URL: optional, remote service
- Update feed URL: for auto updates

If chat/presence fields are blank, the app derives them from the LiveKit host.

Run presence + chat servers (optional, Docker)
----------------------------------------------
From the repo root, run these containers (PowerShell):

Presence server:
  docker run -d --name thecord-presence -p 7882:7882 `
    -e LIVEKIT_API_KEY="YOUR_KEY" `
    -e LIVEKIT_API_SECRET="YOUR_SECRET" `
    -e LIVEKIT_HOST="http://YOUR_LIVEKIT_HOST:7880" `
    -e PRESENCE_PORT=7882 `
    -v ${PWD}:/repo -w /repo/LiveKit node:18-alpine `
    sh -c "npm install --omit=dev && NODE_PATH=/repo/LiveKit/node_modules node /repo/presenceServer/presenceServer.js"

Chat server:
  docker run -d --name thecord-chat -p 7883:7883 `
    -e CHAT_PORT=7883 `
    -v ${PWD}:/repo -w /repo/LiveKit node:18-alpine `
    sh -c "npm install --omit=dev && NODE_PATH=/repo/LiveKit/node_modules node /repo/chatServer/chatServer.js"

Then set the Presence server URL and Chat server URL in the app to your public
server address (with ports) and port-forward those ports as needed.

Tip: to stop/remove containers:
  docker stop thecord-presence thecord-chat
  docker rm thecord-presence thecord-chat

Build a Windows installer
-------------------------
1) Bump version in LiveKit/livekit-desktop/package.json (e.g. 1.0.1)
2) Build:
   cd LiveKit/livekit-desktop
   npm run dist

Output files are in LiveKit/livekit-desktop/dist:
- The.Cord.Setup.x.y.z.exe
- The.Cord.Setup.x.y.z.exe.blockmap
- latest.yml

Auto updates (GitHub Releases)
------------------------------
Auto updates only work in packaged builds (the installer), not in dev.

1) Create a GitHub Release (tag like v1.0.1).
2) Upload these files from dist:
   - latest.yml
   - The.Cord.Setup.x.y.z.exe
   - The.Cord.Setup.x.y.z.exe.blockmap
3) In the app set Update feed URL to:
   https://github.com/OWNER/REPO/releases/latest/download/
4) Restart the app and click "Check updates".

Notes
-----
- If you see a 404 update error, the file names in latest.yml must match the
  uploaded assets exactly.
