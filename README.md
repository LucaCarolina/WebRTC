# WebRTC Smartphone-to-Desktop Control Project
Overall for the assignment i used ai to help me rephrase (phrase sometimes) the readme file, as it was turning to be way too messy when i was doing it myself. 


## What this repository is

The main goal of the project is to create a simple one-to-one connection between a desktop and a phone using a QR code. After connecting, the phone acts as a remote controller for the desktop experience.

For my concept, I decided to build a small interactive scene where the phone controls a laser pointer on the desktop screen and a cat follows that laser.

The project stays simple and easy to run:
- `npm install`
- `npm start`
- open the app on desktop(the terminal will output the localhost link)
- scan the QR code with the phone
- connect both devices
- use the phone as the controller


## Functional idea
The desktop is the main screen where the interaction is shown.

The phone is used as the controller.

WebSockets are only used for the signaling step, meaning they help the devices find each other and exchange the information needed to connect.

After that, the actual control data is sent through a WebRTC data channel, which is the core requirement of the project.


## Current MVP(Minimum Viable Product)
Right now, the project proves these core things:
- a desktop and a phone can connect in a one-to-one setup
- the connection is started through a QR code
- the project runs from a local server started with `npm start`
- the phone can send control data to the desktop
- the desktop reacts to the input coming from the phone



## How it works
The desktop opens the project first and becomes the host.

A QR code is shown on the desktop page.

The phone scans the QR code and joins the same session.

The two devices complete the WebRTC handshake.

Once the connection is established, the phone sends small control messages to the desktop through the data channel.

The desktop reads those messages and updates the visual experience.


## Small code examples

Example of the phone sending control data:

```js
channel.send(JSON.stringify({
  type: "pointer",
  x: 0.42,
  y: 0.61,
  active: true
}));
```

- `x` and `y` represent the position of the laser
- `active` tells the desktop if the pointer is currently being used

Example of the desktop creating the data channel before making the offer:

```js
dataChannel = peerConnection.createDataChannel("control");
const offer = await peerConnection.createOffer();
await peerConnection.setLocalDescription(offer);
```

This part is important because the data channel has to exist before the WebRTC offer is sent.


---

## Week 1
### Goal
Create the first working version of the one-to-one desktop and phone connection.

### What I worked on
During the first week, I focused on setting up the local project and getting the basic connection flow working.

I created the Node.js setup so the project can be started with `npm install` and `npm start`.

I added the local web server, the HTML/CSS/JavaScript frontend, and the signaling layer.

I also added QR code pairing so the phone could join the desktop session in a simple way.

### Code

* STUN configuration (required by the course slides)

```js
var servers = {
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
};
var peerConnection = new RTCPeerConnection(servers);
```

This exact structure came from the assignment slides. STUN helps both devices discover their real public addresses through the Google server so they can attempt a direct peer-to-peer channel without going through any relay.

* WebSocket URL inferred from the page protocol

```js
var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
ws = new WebSocket(proto + '//' + location.host);
```

The signaling socket needs to match the page's own protocol. This means the same code works over plain `ws:` when running locally and over `wss:` when deployed behind HTTPS, without any manual configuration change.

* LAN IP discovery so the QR code is actually scannable

```js
// server.js – exposes the machine's real local IPs
function getLanIPs() {
    const interfaces = os.networkInterfaces();
    const ips = [];
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                ips.push(iface.address);
            }
        }
    }
    return ips.length > 0 ? ips : ['localhost'];
}
```

```js
// app.js – swaps localhost for the real IP when building the QR join URL
if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
    var res = await fetch('/ip');
    var data = await res.json();
    var ip = data.ips.find(function (ip) { return ip !== 'localhost'; });
    if (ip) origin = 'http://' + ip + ':' + location.port;
}
```

* Problem that caused this: The first version of the QR code simply encoded `window.location.href`. When the desktop was opened on `localhost:3000`, the QR pointed to `localhost:3000` as well. When the phone scanned it, `localhost` resolved to the phone itself rather than the laptop, so the page never loaded. The `/ip` endpoint was added to substitute `localhost` with the real LAN address the phone can actually reach.

* Data channel must be created before the offer is sent

```js
async function startOffer() {
    var pc = makePeerConnection();
    dataChannel = pc.createDataChannel('control'); // must come before createOffer
    setupDataChannel();
    var offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    wsSend({ type: 'offer', offer: offer });
}
```

The data channel has to exist before `createOffer()` is called. If it is created after, the SDP offer will not include the data channel negotiation and the phone side will never receive the channel at all.

### Result
By the end of this week, I had a basic WebRTC handshake working between desktop and phone.

The main achievement was reaching a confirmed connected state between the two devices.

### Missed the consult:
By the point of the consult i didnt have too much to show, besides explain the concept, which was pretty messy and unclear even to myself.

## Week 2
### Goal
Move from a basic connection demo toward an actual interactive project idea.

### What I worked on
In the second week, I started exploring what kind of desktop experience the phone could control.

I considered different ideas such as:
- touch input
- tilt input
- accelerometer-based control
- gyroscope-based control
- drawing or laser-pointer style interaction

However, the main priority remains that the base interaction works clearly and reliably:
- desktop opens as host
- phone joins through QR code
- WebRTC data channel connects
- phone sends control input
- desktop updates the experience

After exploring these options, I moved toward the cat-and-laser concept because it was simple, visual, and easy to understand during a demo.

I also started thinking more carefully about the difference between WebSockets and WebRTC, and kept the project aligned with the requirement that WebSockets are only used for signaling.

This week, nothing was pushed to GitHub because of some version control issues

### Code

* Motion sensor control – what was explored and why it did not work

```js
// Attempted approach: let the phone steer the laser by tilting the device
if (typeof DeviceOrientationEvent !== 'undefined' &&
    typeof DeviceOrientationEvent.requestPermission === 'function') {
    const result = await DeviceOrientationEvent.requestPermission();
    // result is 'granted' or 'denied'
}
window.addEventListener('deviceorientation', function(e) {
    var tiltX = e.gamma; // left/right tilt in degrees
    var tiltY = e.beta;  // forward/back tilt in degrees
});
```

* Problem that caused this to be dropped: On iPhone, `requestPermission()` returns `denied` immediately when the page is served over plain HTTP. iOS requires a secure context (`https://`) before it will even prompt the user. Because the local dev server runs on HTTP, the permission was blocked at the OS level before any code could run. Switching the local server to HTTPS was out of scope for an in-class demo, so motion steering was removed entirely and replaced with touch drag, which requires no special permission.

* What replaced it: touch coordinate normalization 

```js
function coords(touch) {
    var r = touchpad.getBoundingClientRect();
    return {
        x: Math.max(0, Math.min(1, (touch.clientX - r.left) / r.width)),
        y: Math.max(0, Math.min(1, (touch.clientY - r.top) / r.height))
    };
}
```

Coordinates are clamped to the `0..1` range so the desktop renderer does not need to know the physical screen size of the phone. The host simply multiplies by canvas width and height to get pixel positions, which means the interaction scales correctly on any device.

* Pointer message format sent over the data channel

```js
dataChannel.send(JSON.stringify({ type: 'pointer', x: x, y: y, active: active }));
```

The payload is kept as small as possible. `active: false` is sent on `touchend` and `touchcancel` so the desktop immediately knows to stop rendering the laser dot and pause cat movement.

### Result
The project direction became much clearer during this week.

Instead of staying as only a connection test, it became a real control-based experience with a defined concept.

### Missed the consult: 
I had missed the consult for personal reasons. As my parants showed up in Kortjik for a suprise visit and it felt bad to not be with them and how them around the city as they werent here for a long time. and as everything was kind of working, and i organised the concept properly i decided to skip the consult. Apologies.


## Week 3
### Goal
Maintain progress if possible and review the project direction.

### What I worked on
I was sick during Week 3, so I was not able to make meaningful development progress.

Because of that, this week contains very little implementation work.

### Missed the consult: 
this week i was sick for 6 days, which i have proven with doctors notes, attached and verified on ibamafex.

## Week 4
### Goal
Return to development, stabilize the main interaction, and test whether extra features can still be added.

### What I worked on
This week I returned to the project and focused again on the main idea: using the phone as a remote controller for the desktop scene.

At this stage, I also want to see whether I can still add extra functionality if time allows.
My next step is to keep improving the stability and clarity of the MVP.

The main priorities are:
- confirm that the one-to-one connection works reliably
- improve the desktop interaction feedback
- make the phone controls feel cleaner
- test whether one or two extra features can be added without breaking the simplicity of the project

Possible extra improvements for this week are:
- smoother cat movement
- cleaner UI feedback
- improved pointer behavior
- more stable connection handling
- optional extra control features if they remain simple enough

### Code

* Room-based signaling replaced the original global peer slots

```js
// server.js – each session gets its own isolated room
const rooms = new Map();

function getRoom(roomId) {
    if (!rooms.has(roomId)) {
        rooms.set(roomId, { host: null, client: null });
    }
    return rooms.get(roomId);
}

function chooseRole(room, requestedRole) {
    if (requestedRole === 'host' || requestedRole === 'client') {
        return room[requestedRole] ? null : requestedRole;
    }
    if (!room.host) return 'host';
    if (!room.client) return 'client';
    return null;
}
```

* Problem that caused this change: The original version used a single global object `let peers = { host: null, client: null }`. If the host refreshed the page while the phone was still connected, the state became inconsistent and the wrong peer could end up assigned the wrong role. Moving to a room map means each session has its own namespace. The room ID is encoded in the QR join URL, so the phone always lands in the correct session even after a reload.

* ICE candidate buffering fixed a connection timing race

```js
var pendingCandidates = [];

async function flushCandidates() {
    if (!peerConnection || !peerConnection.remoteDescription) return;
    while (pendingCandidates.length) {
        await peerConnection.addIceCandidate(new RTCIceCandidate(pendingCandidates.shift()));
    }
}

async function handleCandidate(candidate) {
    if (!peerConnection || !peerConnection.remoteDescription) {
        pendingCandidates.push(candidate); // hold until remote description is ready
        return;
    }
    await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
}
```

* Problem that caused this: During testing, ICE candidates from the phone sometimes arrived at the desktop before `setRemoteDescription` had been called. Calling `addIceCandidate` before that throws a DOM exception and the candidate is silently lost. When too many candidates were lost, the connection either failed entirely or took a very long time to establish. The buffer holds them until the peer connection is ready, then applies them in order.

* Peer disconnect cleanup so the room stays usable

```js
function cleanupPeer(ws) {
    if (!ws.roomId || !ws.role) return;
    const room = rooms.get(ws.roomId);
    if (room[ws.role] === ws) room[ws.role] = null;

    const otherPeer = room[getOtherRole(ws.role)];
    send(otherPeer, { type: 'peer_left', role: ws.role, room: ws.roomId });

    if (!room.host && !room.client) rooms.delete(ws.roomId);
    ws.roomId = null;
    ws.role = null;
}
```

When the phone disconnects, the host receives a `peer_left` message and shows the QR code again. A new device can re-join the same room without the host needing to reload or create a new session.

* Cat lerp movement on the canvas

```js
if (laser.active) {
    cat.x += (laser.x - cat.x) * CAT_LERP;  // CAT_LERP = 0.06
    cat.y += (laser.y - cat.y) * CAT_LERP;
}
```

Linear interpolation at 6% per frame means the cat always moves toward the laser but never instantly snaps to it, which makes the movement feel natural. The cat only moves while `laser.active` is true, so it stops when the finger is lifted rather than drifting or jittering.

*`beforeunload` leave signal to free the room slot immediately

```js
window.addEventListener('beforeunload', function () {
    wsSend({ type: 'leave' });
});
```

Without this, the server would only detect the disconnect after a WebSocket timeout, leaving the room slot occupied for a few seconds. The explicit `leave` message frees it immediately so the other peer gets a `peer_left` notification right away.

---



## Critical reflection on AI use
AI was used as a support tool during the development of this project.

I mainly used AI for:
- understanding WebRTC architecture
- generating or improving starter code
- troubleshooting networking and connection issues
- helping structure documentation and planning

Some parts of the code were AI-assisted, especially the early setup ideas for:
- WebRTC signaling flow
- QR pairing structure
- WebSocket and data channel logic

However, I did not simply copy everything directly without checking it.

I reviewed the generated code, tested it locally, and adjusted parts of it when needed.

The main areas where I modified or simplified AI-generated output were:
- adapting the code to the actual assignment requirements
- changing the interaction idea from more experimental sensor input toward a simpler phone-controller approach
- rewriting documentation into a clearer form that matches the project and course expectations

---------


## Change log
- v0.1: Initial scaffold with local server and project setup
- v0.2: QR pairing and basic signaling flow
- v0.3: Working one-to-one WebRTC connection between desktop and phone
- v0.4: Shift from a technical starter to an actual phone-controlled interaction concept
- v0.5: Current MVP direction focused on the cat-and-laser idea
