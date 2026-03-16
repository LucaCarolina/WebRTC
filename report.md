# Development Report

## 1. Executive Overview
This repository is a small WebRTC control system that evolved from a generic one-to-one data-channel starter into a project-specific "phone controls a laser, cat follows it" MVP. In its current form, the desktop browser acts as the host view, renders a canvas, shows a QR code for pairing, and receives pointer updates over an `RTCDataChannel`. The phone acts as the controller, joins the same room through a scannable link, and sends normalized pointer coordinates while the user drags across a full-screen touchpad.

The final system stays intentionally lightweight. The runtime is a single Node server with `express` for static hosting, `ws` for signaling, and `qrcode` for pairing support. There is no framework, no bundler, no TypeScript, and no build step. The client logic lives in one plain browser script. The project still carries evidence of its origin as a teaching scaffold: the package is still named `webrtc-data-channel-starter`, the dependency list is minimal, and the code uses very direct browser APIs.

Three layers of evidence were used to reconstruct this report:

- Current repository state, especially `package.json`, `server.js`, `public/app.js`, `public/index.html`, `public/style.css`, and `public/cat.svg`
- Preserved git history from `b91f01d` through `7388a66`
- Saved planning/transcript artifacts that document intermediate work no longer fully visible in the rewritten commit history, including the STUN-only recovery plan and the later simplify/redesign plan

Where a statement is based on current code, it is treated as confirmed. Where a statement depends on preserved commits, it is treated as historically evidenced. Where a detail only survives in the transcript or planning files because the code was later rewritten, it is identified as inferred, probable, or transcript-backed.

## 2. Original Goal and MVP Definition
The original goal was to create a simple, demoable WebRTC project that could be started locally with `npm install` and `npm start`, opened on a desktop browser, and paired to a phone. The current `README.md` still preserves the initial framing: this began as a "WebRTC Data Channel Starter (Week 1)" whose first job was only to prove that a desktop and phone could connect one-to-one and reach a confirmed connected state. That early framing matters because it explains several long-lived characteristics of the codebase:

- the architecture is centered on one host and one client
- the networking path is intentionally transparent rather than abstracted behind libraries
- the system values a visible handshake and status updates over feature breadth
- the project remains npm-runnable and classroom-demo friendly

The project-specific idea evolved toward a cat-and-laser interaction because it maps very well onto a minimal WebRTC data channel demo. A phone can naturally act as a handheld controller, the desktop can provide the visual payoff, and the actual real-time message protocol can stay extremely small. Instead of sending complex state, media, or game objects, the controller only needs to send normalized coordinates and an active flag. That makes the MVP technically modest while still feeling interactive and playful.

"Simple but demoable" appears to have meant several things simultaneously:

- no frontend framework
- no authentication or account system
- no database
- no multi-user session complexity beyond one host and one phone
- a visually understandable interaction where connection success is obvious
- a server that can be run locally for development without deployment tooling

That simplicity goal survived even when the project briefly expanded into more ambitious motion controls and richer connection diagnostics. The most recent cleanup work explicitly reversed some of that expansion and restored a more beginner-friendly, smaller codebase.

## 3. Starting Point
The confirmed starting point is commit `b91f01d`, `new: initial rtc handshake`. That initial version was not yet the cat remote. It was a generic WebRTC data-channel starter with four main pieces:

- `server.js` served static files, generated QR codes, and relayed signaling messages through WebSockets
- `public/index.html` rendered a heading, a status area, a QR area, a test-message button, and a message log
- `public/app.js` connected to the signaling server, assigned a role, performed offer/answer/candidate exchange, and let peers send test strings over the data channel
- `public/style.css` used a basic card-based starter layout

The original signaling model was extremely simple. The first socket to connect became `host`, the second became `client`, and any third peer was rejected with a "Room is full" error. The server held one global object:

- `peers.host`
- `peers.client`

Messages were relayed blindly from one side to the other after JSON parsing. On the client side, the host created the data channel, the client listened for it via `ondatachannel`, and both sides exchanged string messages once the channel opened. The QR code simply encoded the current page URL, with a warning if the host was opened on `localhost`.

This starting point explains two important later decisions.

First, WebSocket signaling was chosen because it is the most direct way to satisfy a classroom WebRTC assignment. It gives the peers a common rendezvous point, can carry offers, answers, and ICE candidates with minimal ceremony, and can be implemented in a single file using `ws`.

Second, the project started as a data-channel app rather than a media-stream app. That choice reduced scope substantially. There are no media tracks, no camera or microphone permissions, and no SDP negotiation for streams beyond what WebRTC already handles for the data channel itself.

## 4. System Evolution
The preserved history shows a large jump between the generic starter and the later project-specific implementation. The visible milestones are:

1. `b91f01d` established the generic WebRTC handshake starter.
2. `b48c026` modified only `README.md`, indicating a documentation checkpoint rather than a behavioral change.
3. `6a8fa68` introduced a very large wave of project-specific changes: room-based signaling, QR join links, a cat sprite, a host canvas, a phone touch surface, a motion-control experiment, and richer UI messaging.
4. `74a9bc7` refined that control model further the same day.
5. `965fbb3` removed the entire tilt/motion layer and simplified the code heavily.
6. `7388a66` redesigned the frontend visually without changing the core interaction model.

The size and scope of `6a8fa68` suggest one of two things. Either the project-specific cat remote was built in one concentrated implementation pass, or earlier smaller commits were later rewritten away. The transcript-backed history strongly supports the second interpretation. It documents earlier work that is no longer preserved cleanly in git, including a short-lived `localtunnel` integration, expanded QR instructions for iPhone hotspot users, and a more diagnostic-heavy UI stage.

The most important architectural evolution was the move away from "first browser is host, second browser is client" toward a room-based session model. That change was driven by networking realities. Once the project needed to support reloading, reconnecting, explicit QR pairing, and possibly public deployment, a single global host/client slot was too brittle. A room ID encoded in the URL became the natural bridge between QR pairing and WebSocket signaling.

The second major evolution was the change from a generic text-message data channel into a tiny game/control protocol. Instead of arbitrary strings, the controller sends JSON of the form:

- `type: "pointer"`
- `x: 0..1`
- `y: 0..1`
- `active: true|false`

That narrowed protocol is important. It kept WebRTC in the architecture, but reduced the live control path to the smallest message schema that still supports the interaction.

## 5. Architecture Decisions
Several design choices are visible and well-justified by the codebase.

The first was to keep signaling on the server and control on the peer-to-peer data channel. `server.js` only participates in discovery and negotiation. Once the `RTCDataChannel` is open, pointer updates bypass the server entirely. This is the canonical WebRTC pattern and keeps the architecture honest: WebSockets are used for offer/answer/candidate exchange, not as a fallback control transport pretending to be WebRTC.

The second was to preserve the course-aligned STUN configuration. The current client code creates:

- `const servers = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }`
- `new RTCPeerConnection(servers)`

That exact structure matches the assignment constraints described in the planning evidence. No TURN server is configured in the current code, and no relay fallback exists at runtime. This keeps the implementation aligned with the stated requirement, but also leaves direct-connect limitations intact.

The third was to prefer a small, handwritten frontend over a framework. For this project, a framework would have added setup cost without solving the hard parts. The difficult problems were networking, signaling timing, QR pairing, and browser/device behavior. Plain DOM code keeps those mechanisms visible and easier to reason about.

The fourth was to separate host and client responsibilities in one page rather than build two separate apps. The current app infers an intended role from the URL, shows different panels for host and phone, and keeps both views in the same codebase. That reduces file count and makes the QR flow straightforward: the host page simply generates a client join URL into the same app.

The fifth was to re-simplify after overgrowth. The simplify/redesign plan explicitly describes the prior UI as over-engineered and the motion code as something to strip back out. This is a meaningful decision point, not just a cosmetic cleanup. The codebase deliberately chose understandability and reliability over more sophisticated but fragile interaction ideas.

## 6. Signaling, Handshake, and Connection Lifecycle
The current connection process is more structured than the original starter but still intentionally direct.

When the page loads, `public/app.js` parses two URL parameters:

- `room`
- `role`

If no room exists and the requested role is host, the host creates one locally using a short random string. The app then opens a WebSocket to the same origin, using `wss:` when loaded over HTTPS and `ws:` otherwise.

Once the socket opens, the client sends a signaling message:

- `type: "join"`
- `room`
- `requestedRole`

The server validates the room ID, resolves a role, stores the socket in that room, and replies with:

- `type: "joined"`
- `room`
- `role`
- `peerPresent`

If both peers are present, the server also emits `peer_ready` notifications. At that point the WebRTC handshake begins.

The current handshake path is:

1. Host creates an `RTCPeerConnection`.
2. Host creates the `control` data channel explicitly.
3. Host calls `createOffer()`.
4. Host sets the offer as local description.
5. Host sends `{ type: "offer", offer }` over WebSocket.
6. Client receives the offer, creates its own peer connection, sets the offer as remote description, creates an answer, sets local description, and sends `{ type: "answer", answer }`.
7. Host receives the answer and sets it as remote description.
8. Both sides send ICE candidates through `{ type: "candidate", candidate }` as they are discovered.

One important improvement over the original starter is candidate buffering. The current app stores remote candidates in `pendingCandidates` if the peer connection does not yet have a `remoteDescription`. Once the remote description is set, `flushCandidates()` adds them in order. This is a practical fix for real-world signaling timing, because candidates can arrive before the other side has completed SDP setup.

The data-channel lifecycle is also explicit.

- The host creates the channel during offer creation.
- The client receives it through `peerConnection.ondatachannel`.
- `setupDataChannel()` attaches `onopen`, `onclose`, and `onmessage`.
- Host uses `onmessage` to update laser state.
- Client uses `onopen` to initialize the touchpad controller.

Disconnect behavior is handled at two layers.

- If the signaling socket closes before the data channel is established, the UI reports a server disconnection and shows retry.
- If the peer leaves after the room is joined, the server emits `peer_left`, the app resets WebRTC state, and the host returns to a waiting/QR state.

This lifecycle is simple enough for a student project, but much more robust than the original blind relay starter.

## 7. Rooms, Sessions, and Peer Coordination
The current room model lives entirely in memory inside `server.js`. The server stores:

- a `Map` named `rooms`
- each entry shaped as `{ host: null, client: null }`

This is a volatile signaling layer. Rooms disappear when both peers leave, there is no persistence, and server restarts destroy all session state. That is acceptable for an MVP demo and consistent with the goal of keeping the stack lightweight.

Role assignment works through `chooseRole(room, requestedRole)`. The current behavior is:

- if `requestedRole` is `host` or `client`, the server tries to grant that slot only if it is free
- if no explicit role is requested, the server auto-fills host first, then client
- if the requested slot is occupied, the server rejects the join with an error

Extra peers are therefore rejected at the slot level, not by a broader participant counter. This keeps the room semantically one-to-one.

Cleanup is handled by `cleanupPeer(ws)`. When a peer leaves or disconnects:

- the socket is removed from its role slot
- the other peer, if present, receives `peer_left`
- if both host and client are now absent, the room entry is deleted
- the socket's own `roomId` and `role` fields are cleared

Reconnection is partially supported. If the host remains in the room and the phone disconnects, the room survives and the host shows the QR again. A new controller can rejoin the same room and trigger a fresh offer. If the host leaves, the client is told the host is gone and must reload after the host recreates or re-enters the room. There is no durable session recovery beyond that.

One subtle but useful behavior is that `joinRoom()` calls `cleanupPeer(ws)` before assigning the new room. That means a socket can theoretically rejoin another room without leaving stale room membership behind. For a small app, this is a reasonable safeguard.

## 8. Input Model Evolution
The input model went through the most visible experimentation.

The preserved starter did not yet implement cat control. It only sent test messages. The later code converted the data channel into a controller path and explored multiple schemes.

The confirmed current input model is direct touch drag. On the phone:

- `touchstart` and `touchmove` compute normalized coordinates relative to the touchpad rectangle
- the app sends `{ type: "pointer", x, y, active: true }`
- `touchend` and `touchcancel` send `{ type: "pointer", active: false }`
- a mouse fallback exists for desktop testing

This is the most reliable scheme because it depends only on standard touch/mouse events and does not require HTTPS sensor permissions.

However, the git history and transcript clearly show that motion-sensor control was explored in depth. The `6a8fa68` snapshot of `public/app.js` includes:

- motion-permission state
- `DeviceOrientationEvent` handling
- neutral tilt calibration
- tilt normalization and deadzone logic
- a hold-to-activate control loop
- a visible "Enable motion control" button

The intended interaction at that stage was:

- press and hold to activate the laser
- tilt the phone to steer the dot
- release to turn the laser off

This was an appealing idea because it made the controller feel more like a physical pointing device. It also matched the theme of directing a laser rather than dragging one.

But this interaction failed in the intended environment for reasons that are well-supported by the transcript evidence. iPhone motion APIs require a secure context and user-triggered permission flow. On plain HTTP, especially in the hotspot-based testing setup, `DeviceOrientationEvent.requestPermission()` could be denied immediately. The transcript explicitly records the realization that the earlier settings-only guidance was incomplete and that the real blocker was the secure-origin requirement.

What was learned from that failure is important:

- browser sensor APIs are much more deployment-sensitive than touch events
- a locally hosted HTTP demo can still support WebRTC signaling and data channels, but not all sensor APIs
- iOS browsers share the same WebKit restrictions, so switching from Safari to Chrome on iPhone does not bypass the constraint
- a fancy control metaphor is not worth keeping if it is less reliable than a simpler direct-touch controller

The project therefore converged back to touch input as the reliable MVP. The simplify plan states this explicitly: all motion/tilt code was removed, the touchpad returned to direct dragging, and the JavaScript was cut from roughly 925 lines to roughly 400.

## 9. Networking Challenges
Networking was the hardest non-UI part of the project.

The original local assumption was that the host laptop could run the Node server and the phone could join by scanning a QR code containing the same page URL. That works only if the phone can actually reach the host's HTTP server. `localhost` was immediately insufficient because a phone cannot resolve its own `localhost` as the laptop. This is why both the starter and current code contain special handling for LAN IP discovery.

The current `/ip` endpoint exists solely to help the host replace `localhost` with a reachable local address when needed. If the app is already opened on a non-local hostname, `public/app.js` simply uses `location.origin`. If it is opened on `localhost` or `127.0.0.1`, it fetches `/ip`, picks a non-localhost address, and builds the join URL from that.

The transcript-backed history shows that this still was not enough in one critical test setup: a laptop connected to an iPhone hotspot, with the same iPhone also intended to be the controller. In that configuration, the phone was effectively the router and could not reliably browse to the laptop's hotspot-assigned `172.20.10.x` address. That made the local QR flow fail even though the server itself was running correctly.

This led to a tunneling attempt. According to the transcript evidence, `localtunnel` was briefly added as a dependency so the server could expose a public `https://*.loca.lt` URL. The idea was sound: if the phone could not reach the laptop over the hotspot LAN, it could instead reach a public URL over the internet, and the existing WebSocket signaling plus STUN path could proceed from there. However, this attempt failed in practice due to a localtunnel security wall followed by `503 Tunnel Unavailable` responses. The transcript notes that this behavior likely reflected service instability or tunnel-side limitations. That code was later removed and is no longer present in the current repository history.

The STUN-only recovery plan documents the next architectural conclusion: use a public HTTPS/WSS deployment of the same app when broad network compatibility is required, but accept that STUN without TURN still cannot guarantee connectivity across all NATs and networks. This is a key distinction:

- public signaling solves reachability of the webpage and signaling server
- STUN helps peers discover reflexive addresses and attempt direct P2P
- TURN would be needed to guarantee a relay path when direct ICE fails

TURN was discussed but not implemented. Current code contains only the Google STUN server. The transcript and planning material mention TURN or coturn only as a theoretical fallback that was outside the chosen scope. This means the current app can fail on restrictive university Wi-Fi, carrier NATs, or other environments that block successful UDP hole punching, even if both peers can load the site and complete signaling.

Hotspot testing became attractive because it was available and controllable compared to secured university Wi-Fi, but it also exposed the sharpest edge cases: same-device hotspot routing, HTTP sensor restrictions, and the difference between signaling reachability and direct peer connectivity.

## 10. Major Issues and Resolutions

### 10.1 `localhost` QR links were unusable from the phone
Symptom: the desktop could open the app locally, but a phone scanning a QR code pointing to `localhost` could not reach the server.

Probable cause: `localhost` on the phone resolves to the phone itself, not the desktop host.

Where it appeared: the initial starter logic and the general local-development boot flow.

How it was fixed: both early and current implementations detect localhost and substitute a LAN IP instead. The current app does this through `/ip` and `getJoinUrl()`.

Remaining fragility: LAN IP replacement only helps if the phone can actually route to that IP.

### 10.2 Global two-peer signaling was too brittle
Symptom: the original "first socket host, second socket client" design could not support explicit room URLs, reconnects, or multiple independent sessions.

Probable cause: all server state lived in one global `peers` object, with no session namespace.

Where it appeared: `server.js` in `b91f01d`.

How it was fixed: the server was refactored to an in-memory `rooms` map with `join`, `peer_ready`, `peer_left`, and role-slot assignment.

Remaining fragility: room state is still volatile and in-memory only.

### 10.3 ICE candidates could arrive before remote description was set
Symptom: a peer could receive candidates before its `RTCPeerConnection` was ready to accept them.

Probable cause: signaling timing is asynchronous, and candidate delivery can race ahead of SDP setup.

Where it appeared: this is a standard WebRTC timing hazard; the current code specifically guards against it.

How it was fixed: `pendingCandidates` buffers incoming candidates until `remoteDescription` exists, then `flushCandidates()` applies them.

Remaining fragility: the code assumes normal signaling order and does not implement more advanced duplicate or restart handling.

### 10.4 Same-iPhone hotspot routing broke local access
Symptom: the phone providing the hotspot could not reliably browse to the laptop's hotspot LAN IP.

Probable cause: iOS hotspot routing behavior prevented the phone from treating the tethered laptop as an ordinary reachable LAN host in that scenario.

Where it appeared: transcript-backed test history involving `172.20.10.x` hotspot addresses.

How it was addressed: first by trying clearer LAN guidance, then by attempting a public tunnel, and later by planning around public HTTPS/WSS deployment plus room-based join links.

Remaining fragility: this is not fully solvable in a pure local setup if the phone cannot route to the laptop.

### 10.5 `localtunnel` did not provide a stable demo path
Symptom: instead of serving the app reliably, the tunnel flow hit a password/security wall and then a `503 Tunnel Unavailable`.

Probable cause: third-party tunnel instability or limitations of the free service.

Where it appeared: transcript-backed history; the current repository no longer contains this code.

How it was fixed: the dependency and tunnel logic were removed, restoring simpler LAN behavior in code and leaving public deployment or manual external tunneling as out-of-repo options.

Remaining fragility: the repository itself still does not ship a guaranteed public deployment path.

### 10.6 Motion control failed under real browser security constraints
Symptom: motion permission was denied automatically on the phone.

Probable cause: iOS secure-context requirements and user-gesture restrictions for motion/orientation APIs.

Where it appeared: the motion-control implementation in `6a8fa68` and transcript debugging around `DeviceOrientationEvent.requestPermission()`.

How it was fixed: not by forcing motion to work, but by abandoning it as the primary control scheme and reverting to touch drag.

Remaining fragility: motion could still be reintroduced only under HTTPS and with careful device-specific handling.

### 10.7 The UI became over-explained and harder to follow
Symptom: session meta blocks, help cards, diagnostic messages, and motion controls added complexity beyond what the final MVP needed.

Probable cause: legitimate attempts to explain STUN-only behavior and motion permissions caused the interface to accumulate support scaffolding.

Where it appeared: the `6a8fa68` generation of `public/index.html`, `public/style.css`, and `public/app.js`.

How it was fixed: `965fbb3` removed the extra help system, motion button, session meta, and verbose messaging, returning the app to a smaller, more student-readable shape.

Remaining fragility: less diagnostic detail means some network failures are now explained less thoroughly in the UI than they were in the more verbose iteration.

### 10.8 Visual presentation risked feeling generic
Symptom: the frontend had a fairly standard dark blue "starter project" aesthetic.

Probable cause: default UI styling common to quick prototypes.

Where it appeared: earlier CSS, especially the dark blue diagnostic phase.

How it was fixed: `7388a66` rewrote the styling around a warm nighttime palette, `Syne` typography, softer surfaces, and a tactile phone pad while leaving the structure minimal.

Remaining fragility: the visual redesign improves identity, but the app is still structurally sparse by design.

## 11. Current File-by-File Architecture
`package.json` defines the project as a Node app with one `start` script and three runtime dependencies: `express`, `qrcode`, and `ws`. The name `webrtc-data-channel-starter` is itself a historical artifact that confirms the project's origin.

`server.js` is the entire backend. It serves the static frontend, provides `/qr` for on-demand QR code HTML, provides `/ip` for LAN IP discovery, and runs the WebSocket signaling server. It owns room state, join validation, role allocation, relay of `offer`/`answer`/`candidate`, and disconnect cleanup.

`public/index.html` is a two-mode shell. It contains a status chip, a retry button, a host panel with a QR area and canvas, and a phone panel with a short instruction plus touchpad. There are no separate pages for desktop and phone.

`public/style.css` provides the final look and role-specific layout. The host gets a QR card and a large canvas. The phone gets a nearly full-screen pad with a visible red touch dot. The styles intentionally avoid heavy component complexity.

`public/app.js` contains almost all client behavior. Its responsibilities are:

- parse room and role from the URL
- generate a room ID for the host when needed
- normalize the share URL for LAN or public origin
- connect to the signaling socket
- manage the WebRTC handshake
- queue and flush ICE candidates
- show status and retry states
- initialize the host renderer
- initialize the phone touch controller
- send and receive the pointer message protocol

`public/cat.svg` is a static sprite asset used by the canvas renderer. This is a deliberately low-tech choice: using a small SVG image avoids the need for a sprite pipeline or canvas drawing code for the cat itself.

`report.md` is the development report added during this task. `README.md` was intentionally left untouched.

## 12. Technical Lessons Learned
This project demonstrates that the hardest part of a small WebRTC demo is rarely the API syntax itself. The offer/answer/candidate flow can be implemented in a few dozen lines. The real complexity comes from environment constraints:

- how peers discover one another
- whether both devices can reach the signaling server
- whether the network allows direct ICE success
- whether browser security policy blocks the intended input method

Another lesson is that a narrow message protocol is a major advantage. Once the project stopped treating the data channel as a generic message pipe and instead used a tiny pointer schema, the interaction became easy to reason about and easy to debug.

The project also shows the difference between "connection succeeded" and "product is demoable." A technically correct WebRTC stack can still feel broken if the QR points to an unreachable host, if status messages are unclear, or if the phone control metaphor depends on APIs that fail on the chosen test setup.

Finally, there is a practical lesson about scope management. Motion control was a creative idea, but it depended on HTTPS, browser permissions, and device-specific behavior. Touch dragging was less ambitious, but far more robust. For a student MVP, that trade was correct.

## 13. Remaining Limitations and Future Improvements
The current system is functional but still intentionally limited.

- It is STUN-only. There is no TURN relay, so direct connectivity can fail on restrictive networks.
- Room state is in-memory only. Restarting the server wipes active sessions.
- Reconnection works only in a simple "rejoin the same room" sense. There is no ICE restart or advanced recovery.
- The `beforeunload` leave signal is best-effort only and not guaranteed.
- The pointer protocol is deliberately tiny and does not include timestamps, smoothing hints, or acknowledgments.
- The host renderer is always on one canvas and does not support multiple scenes or richer game logic.
- The UI currently favors simplicity over rich diagnostics, so some networking failures still require developer interpretation.

Reasonable future improvements would be:

- optional TURN support for environments where direct P2P is blocked
- deployment guidance for HTTPS/WSS hosting
- explicit ICE-state diagnostics restored in a toned-down form
- optional motion control behind secure-origin detection only
- a small connection test panel that explains whether signaling succeeded but ICE failed

## 14. Developer Reconstruction Notes
If this repository needs to be explained again later, the simplest mental model is:

This started as a generic one-to-one WebRTC data-channel proof of connection. The final project-specific goal became "phone controls a laser on the desktop, cat chases it." The server's real job is only static hosting plus signaling. The actual control path is peer-to-peer. The phone never streams media; it only sends pointer JSON. The desktop never sends rich state back; it just renders.

The clearest development phases are:

1. starter handshake phase
2. project-specific expansion into QR pairing, rooms, host canvas, and phone control
3. networking troubleshooting around LAN reachability, hotspot behavior, and public-access ideas
4. motion-sensor experiment and rejection
5. simplification back to drag control
6. final visual redesign

If writing a future README, the main technical story to preserve is not just "this is a cat laser app." The real story is that it is a WebRTC data-channel demo shaped by practical networking constraints:

- QR pairing exists because the phone needs a frictionless way to open the correct session
- room IDs exist because global host/client slots were too brittle
- `/ip` exists because `localhost` is not scannable from another device
- STUN exists because the assignment required ICE-based peer setup
- TURN does not exist because the project stayed within a simpler scope
- motion control was explored but dropped because browser security and deployment requirements made it unreliable for the intended demo

For future maintenance, `public/app.js` is the file that encodes almost all behavioral intent. `server.js` is small and mostly stable. If the app ever needs to become more reliable across mixed networks, the next architectural leap is not a frontend rewrite; it is adding a relay strategy or deploying the existing server publicly over HTTPS/WSS.

This task intentionally did not modify `README.md`; it only created this standalone report so the repository's historical and architectural context can be rewritten manually later in a cleaner form.
