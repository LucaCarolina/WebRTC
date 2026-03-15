# Cat Laser Pointer Remote

A minimal WebRTC demo where your phone becomes a laser pointer remote and a cat chases the dot on your desktop screen.

## Networking Model

This project intentionally uses:

- a `WebSocket` signaling server so the peers can discover each other
- WebRTC offer/answer exchange over that signaling channel
- ICE candidate exchange over that signaling channel
- a STUN server for direct peer-to-peer path discovery
- an `RTCDataChannel` for the actual pointer messages

The browser-side peer connection follows the course slide pattern:

```js
const servers = {
  iceServers: [{
    urls: 'stun:stun.l.google.com:19302'
  }]
};

const peerConnection = new RTCPeerConnection(servers);
```

## Important Limitation

This is a STUN-only WebRTC app. That means:

- it works on many normal Wi-Fi and mobile network combinations
- it does **not** guarantee success on every network
- restrictive university networks, carrier NATs, and some hotspot setups can still block direct peer-to-peer connectivity

That is a real networking constraint, not a bug in your signaling flow. Without TURN, the correct engineering approach is to make signaling reliable, maximize the number of networks where direct ICE succeeds, and show clear diagnostics when a direct path cannot be established.

## How It Works

1. **Desktop host** opens the app and creates a room
2. The app generates a room-specific QR code and join URL for the **phone controller**
3. Both peers connect to the same Node.js `WebSocket` signaling server
4. The signaling server relays `offer`, `answer`, and `candidate` messages
5. ICE + STUN attempt to form a direct peer-to-peer connection
6. The phone sends touch coordinates over an `RTCDataChannel`
7. The desktop renders a laser dot and a cat chasing it on a canvas

## Quick Start

```bash
npm install
npm start
```

### Local Dev

Open the app on your desktop, then scan the generated QR code or open the join URL on the phone.

- If you are running locally, open the printed LAN URL on your desktop instead of `localhost` when the phone needs to reach the laptop directly.
- iPhone hotspot self-routing is unreliable for the same phone that is providing the hotspot.
- Some networks will still fail at the ICE stage because this project intentionally does not use TURN.

### Best Demo Setup

For the widest practical compatibility, deploy this same Node app to a public HTTPS host that supports WebSockets.

That gives you:

- a publicly reachable page for both peers
- a publicly reachable signaling server
- the ability to test across different networks without relying on laptop LAN reachability

Even then, STUN-only direct peer-to-peer can still fail on restrictive networks. The app now reports that case explicitly instead of silently hanging.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Server | Node.js, Express, ws (WebSocket) |
| Signaling | WebSocket (offer/answer/ICE relay) |
| NAT traversal | ICE + STUN |
| Real-time control | WebRTC Data Channel |
| Frontend | Vanilla HTML / CSS / JS, Canvas API |
| Pairing | QR code (qrcode npm package) |

## Project Structure

```
├── server.js          # Express + WebSocket signaling server
├── package.json       # Dependencies: express, ws, qrcode
└── public/
    ├── index.html     # Host canvas + phone touchpad panels
    ├── style.css      # Dark theme styling
    ├── app.js         # Signaling, WebRTC, rendering, touch input
    └── cat.svg        # Cat sprite
```

## Data Channel Protocol

Messages sent from phone → desktop over the RTCDataChannel:

```json
{ "type": "pointer", "x": 0.42, "y": 0.61, "active": true }
{ "type": "pointer", "active": false }
```

- `x`, `y`: normalized coordinates (0–1) relative to the touchpad
- `active`: whether the user is currently touching the screen

## Architecture

```
Phone (controller)           Public or LAN Node app            Desktop (host)
      │                       (static + WebSocket)                 │
      ├── HTTPS/WSS ───────────────►│◄──────────────── HTTPS/WSS ──┤
      │                             │                              │
      ├── offer/answer/candidate ──►│── relay ────────────────────►│
      │                             │                              │
      ├──────────── RTCDataChannel / ICE + STUN direct path ──────►│
      │                             │                              │
      │                       server not used for gameplay         │
```

## Expected Test Results

These scenarios should be tested and documented:

- same Wi-Fi network
- laptop on Wi-Fi and phone on cellular, both using the same public deployment
- iPhone hotspot with both peers opening the public deployment
- university network
- at least one negative case where signaling works but ICE direct connectivity fails

In the negative case, the expected behavior is:

- signaling joins the room successfully
- offer/answer/candidate exchange still occurs
- the app reports that direct STUN-only connectivity failed on that network
