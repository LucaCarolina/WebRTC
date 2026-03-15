// ─── DOM References ───
const statusDiv = document.getElementById('status');
const sessionMetaDiv = document.getElementById('session-meta');
const helpDiv = document.getElementById('connection-help');
const retryBtn = document.getElementById('retry-btn');
const hostPanel = document.getElementById('host-panel');
const phonePanel = document.getElementById('phone-panel');
const phoneInstruction = document.getElementById('phone-instruction');
const motionBtn = document.getElementById('motion-btn');
const qrDiv = document.getElementById('qr');
const canvas = document.getElementById('arena');
const touchpad = document.getElementById('touchpad');
const touchDot = document.getElementById('touch-dot');

// ─── Session State ───
let ws;
let peerConnection;
let dataChannel;
let myRole = null;
let peerPresent = false;
let pendingRemoteCandidates = [];
let offerInProgress = false;
let hostRendererStarted = false;
let touchpadInitialized = false;
let motionListenerInitialized = false;
let controlLoopRunning = false;
let controlActive = false;
let controlPointer = { x: 0.5, y: 0.5 };
let neutralTilt = { beta: 0, gamma: 0 };
let latestTilt = { beta: 0, gamma: 0, hasReading: false };
let motionPermissionState = 'unknown';

const initialParams = new URLSearchParams(location.search);
const requestedRole = initialParams.get('role') === 'client' ? 'client' : 'host';
let roomId = sanitizeRoomId(initialParams.get('room')) || '';

if (!roomId && requestedRole === 'host') {
    roomId = createRoomId();
}

// Laser + cat state (host only)
let laser = { x: 0.5, y: 0.5, active: false };
let cat = { x: 0.5, y: 0.5 };
let catImg = null;
const CAT_LERP = 0.06;
const CAT_SIZE = 64;
const TILT_RANGE_DEGREES = 30;
const TILT_DEADZONE = 0.08;
const POINTER_SPEED = 0.85;

// Keep the RTCPeerConnection setup aligned with the course slides.
const servers = {
    iceServers: [{
        urls: 'stun:stun.l.google.com:19302'
    }]
};

function sanitizeRoomId(value) {
    if (!value) return '';
    return /^[a-zA-Z0-9_-]{4,32}$/.test(value) ? value : '';
}

function createRoomId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
        return window.crypto.randomUUID().split('-')[0];
    }
    return Math.random().toString(36).slice(2, 10);
}

function updateAddressBar() {
    const url = new URL(location.href);
    url.searchParams.set('room', roomId);
    if (requestedRole === 'client') {
        url.searchParams.set('role', 'client');
    } else {
        url.searchParams.delete('role');
    }
    history.replaceState({}, '', url);
}

function updateStatus(message, state) {
    statusDiv.textContent = message;
    statusDiv.className = 'status' + (state ? ' ' + state : '');
}

function showHelp(message, tone = 'info') {
    if (!message) {
        helpDiv.className = 'help-card hidden';
        helpDiv.innerHTML = '';
        return;
    }
    helpDiv.className = `help-card ${tone}`;
    helpDiv.innerHTML = message;
}

function setRetryButton(visible, label = 'Retry connection') {
    retryBtn.textContent = label;
    retryBtn.classList.toggle('hidden', !visible);
}

function updateSessionMeta(extra = '') {
    const activeRole = myRole || requestedRole;
    const roleLabel = activeRole === 'host' ? 'desktop host' : 'phone controller';
    const peerLabel = peerPresent ? 'Peer joined' : 'Waiting for peer';
    sessionMetaDiv.innerHTML = `Room <code>${roomId || 'pending'}</code> • ${roleLabel} • ${peerLabel}${extra ? ` • ${extra}` : ''}`;
}

function renderPanels() {
    const activeRole = myRole || requestedRole;
    hostPanel.classList.toggle('hidden', activeRole !== 'host');
    phonePanel.classList.toggle('hidden', activeRole !== 'client');
}

function isDataChannelOpen() {
    return Boolean(dataChannel && dataChannel.readyState === 'open');
}

function sendSignal(payload) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(payload));
}

async function resolveShareOrigin() {
    if (location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
        return location.origin;
    }

    const res = await fetch('/ip');
    const { ips } = await res.json();
    const lanIp = ips.find((ip) => ip !== 'localhost');

    if (!lanIp) {
        throw new Error('Could not determine a reachable LAN IP.');
    }

    return `http://${lanIp}:${location.port}`;
}

async function buildClientJoinUrl() {
    const origin = await resolveShareOrigin();
    const url = new URL(location.pathname || '/', origin);
    url.searchParams.set('room', roomId);
    url.searchParams.set('role', 'client');
    return url.toString();
}

function setDefaultHelp() {
    if ((myRole || requestedRole) === 'host') {
        showHelp(
            'Share the QR code with the controller device. If this app is deployed publicly over HTTPS/WSS, both peers can load it from different networks. In local LAN mode, the phone must still be able to reach the laptop directly.',
            'info'
        );
    } else {
        showHelp(
            'Keep this page open while ICE checks connectivity. Once connected, press and hold the pad to activate the laser, then tilt the phone to steer it.',
            'info'
        );
    }
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function updateTouchDotPosition() {
    touchDot.style.left = (controlPointer.x * 100) + '%';
    touchDot.style.top = (controlPointer.y * 100) + '%';
}

function sendPointerState(active) {
    if (!isDataChannelOpen()) return;

    dataChannel.send(JSON.stringify({
        type: 'pointer',
        x: controlPointer.x,
        y: controlPointer.y,
        active,
    }));
}

function updateMotionButton() {
    const needsExplicitPermission = typeof DeviceOrientationEvent !== 'undefined' &&
        typeof DeviceOrientationEvent.requestPermission === 'function';

    motionBtn.classList.toggle('hidden', myRole !== 'client' || !needsExplicitPermission || motionPermissionState === 'granted');
}

function handleDeviceOrientation(event) {
    if (typeof event.beta !== 'number' || typeof event.gamma !== 'number') {
        return;
    }

    latestTilt = {
        beta: event.beta,
        gamma: event.gamma,
        hasReading: true,
    };

    if (controlActive) {
        phoneInstruction.textContent = 'Hold to keep the laser on. Tilt the phone to steer the dot.';
    }
}

function ensureMotionListener() {
    if (motionListenerInitialized || typeof window.DeviceOrientationEvent === 'undefined') {
        return;
    }

    window.addEventListener('deviceorientation', handleDeviceOrientation, true);
    motionListenerInitialized = true;
}

async function requestMotionPermission() {
    ensureMotionListener();

    if (typeof DeviceOrientationEvent === 'undefined') {
        motionPermissionState = 'unsupported';
        showHelp('This browser does not expose motion sensors, so tilt aiming is unavailable here.', 'warn');
        updateMotionButton();
        return false;
    }

    if (typeof DeviceOrientationEvent.requestPermission !== 'function') {
        motionPermissionState = 'granted';
        updateMotionButton();
        return true;
    }

    if (motionPermissionState === 'granted') {
        return true;
    }

    try {
        const result = await DeviceOrientationEvent.requestPermission();
        motionPermissionState = result === 'granted' ? 'granted' : 'denied';
    } catch (error) {
        console.error('Motion permission request failed', error);
        motionPermissionState = 'denied';
    }

    updateMotionButton();

    if (motionPermissionState !== 'granted') {
        showHelp('Motion access was denied, so the phone cannot steer by tilt. Enable motion access in Safari settings and try again.', 'warn');
        return false;
    }

    showHelp('Motion access granted. Press and hold the pad, then tilt the phone to steer the laser.', 'success');
    return true;
}

function normalizeTilt(delta) {
    const scaled = clamp(delta / TILT_RANGE_DEGREES, -1, 1);
    if (Math.abs(scaled) < TILT_DEADZONE) {
        return 0;
    }

    return scaled;
}

function getTiltVector() {
    if (!latestTilt.hasReading) {
        return { x: 0, y: 0 };
    }

    return {
        x: normalizeTilt(latestTilt.gamma - neutralTilt.gamma),
        y: normalizeTilt(latestTilt.beta - neutralTilt.beta),
    };
}

function startControlLoop() {
    if (controlLoopRunning) return;
    controlLoopRunning = true;

    let lastTimestamp = performance.now();

    function frame(timestamp) {
        const deltaSeconds = Math.min((timestamp - lastTimestamp) / 1000, 0.05);
        lastTimestamp = timestamp;

        if (controlActive) {
            const tilt = getTiltVector();
            controlPointer.x = clamp(controlPointer.x + (tilt.x * POINTER_SPEED * deltaSeconds), 0, 1);
            controlPointer.y = clamp(controlPointer.y + (tilt.y * POINTER_SPEED * deltaSeconds), 0, 1);
            updateTouchDotPosition();
            touchDot.classList.remove('hidden');
            sendPointerState(true);
        }

        requestAnimationFrame(frame);
    }

    requestAnimationFrame(frame);
}

async function beginLaserControl() {
    const permissionGranted = await requestMotionPermission();
    if (!permissionGranted && typeof DeviceOrientationEvent !== 'undefined') {
        return false;
    }

    if (latestTilt.hasReading) {
        neutralTilt = {
            beta: latestTilt.beta,
            gamma: latestTilt.gamma,
        };
    }

    controlActive = true;
    updateTouchDotPosition();
    touchDot.classList.remove('hidden');
    sendPointerState(true);
    startControlLoop();

    if (latestTilt.hasReading) {
        phoneInstruction.textContent = 'Hold to keep the laser on. Tilt the phone to steer the dot.';
    } else {
        phoneInstruction.textContent = 'Hold to keep the laser on. Waiting for motion sensor readings...';
    }

    return true;
}

function endLaserControl() {
    controlActive = false;
    touchDot.classList.add('hidden');
    sendPointerState(false);
    phoneInstruction.textContent = 'Press and hold the pad, then tilt the phone to steer the laser';
}

async function showQRCode() {
    try {
        const targetUrl = await buildClientJoinUrl();
        const qrRes = await fetch('/qr?url=' + encodeURIComponent(targetUrl));
        const html = await qrRes.text();
        const target = new URL(targetUrl);
        const usesDirectLocalAddress = target.protocol === 'http:' &&
            (/^localhost$|^127\.0\.0\.1$/.test(target.hostname) || /^(\d{1,3}\.){3}\d{1,3}$/.test(target.hostname));
        const localNote = usesDirectLocalAddress
            ? 'You are in local dev mode, so this QR points to your laptop LAN address. That works only when the phone can actually reach the laptop on the same local network.'
            : 'This QR points back to the current site origin, so it works for public HTTPS deployments and cross-network demos as long as STUN can establish a direct path.';

        qrDiv.classList.remove('hidden');
        qrDiv.innerHTML = `
            <p class="qr-title">Scan to join room ${roomId}</p>
            ${html}
            <p class="qr-url">${targetUrl}</p>
            <p class="qr-note">${localNote}</p>
        `;
        updateSessionMeta('Share via QR or URL');
    } catch (error) {
        console.error(error);
        qrDiv.classList.remove('hidden');
        qrDiv.innerHTML = '<p style="color:#ff7f7f">Failed to generate a join URL. Open the app from a reachable LAN or public URL and try again.</p>';
        showHelp(
            'The host could not build a reachable join link. If you started from <code>localhost</code>, open the LAN URL from your terminal or deploy the app publicly over HTTPS/WSS.',
            'error'
        );
        setRetryButton(true, 'Reload session');
    }
}

function resetRtcState() {
    offerInProgress = false;
    pendingRemoteCandidates = [];

    if (dataChannel) {
        dataChannel.onopen = null;
        dataChannel.onclose = null;
        dataChannel.onmessage = null;
        if (dataChannel.readyState !== 'closed') {
            dataChannel.close();
        }
    }
    dataChannel = null;

    if (peerConnection) {
        peerConnection.onicecandidate = null;
        peerConnection.onicegatheringstatechange = null;
        peerConnection.oniceconnectionstatechange = null;
        peerConnection.onconnectionstatechange = null;
        peerConnection.ondatachannel = null;
        if (peerConnection.signalingState !== 'closed') {
            peerConnection.close();
        }
    }
    peerConnection = null;
}

function createPeerConnection() {
    if (peerConnection) return peerConnection;

    peerConnection = new RTCPeerConnection(servers);

    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            sendSignal({ type: 'candidate', candidate: event.candidate });
        }
    };

    peerConnection.onicegatheringstatechange = () => {
        if (!peerConnection || isDataChannelOpen()) return;

        if (peerConnection.iceGatheringState === 'gathering') {
            updateStatus('Gathering ICE candidates…');
            showHelp('ICE is collecting local and STUN-discovered network candidates before testing them.', 'info');
        } else if (peerConnection.iceGatheringState === 'complete') {
            updateStatus('ICE gathering complete. Checking connectivity…');
        }
    };

    peerConnection.oniceconnectionstatechange = () => {
        if (!peerConnection) return;

        const state = peerConnection.iceConnectionState;
        if (state === 'checking') {
            updateStatus('Checking direct peer-to-peer connectivity…');
            showHelp('STUN is now testing candidate pairs between both peers. This can take a few seconds.', 'info');
        } else if (state === 'connected' || state === 'completed') {
            updateStatus('Peer-to-peer path found. Opening data channel…');
            showHelp('ICE succeeded and a direct path exists. The RTCDataChannel should open momentarily.', 'success');
        } else if (state === 'disconnected') {
            updateStatus('Peer connection dropped. Retry this room or re-scan the QR code.', 'error');
            showHelp('The direct path was interrupted. This can happen when a network changes or an aggressive NAT drops the mapping.', 'warn');
            setRetryButton(true);
        } else if (state === 'failed') {
            updateStatus('Direct peer-to-peer connection failed on this network.', 'error');
            showHelp('Signaling still worked, but STUN could not establish a direct path. Without TURN, that can still happen on restrictive university, carrier, or hotspot networks.', 'error');
            setRetryButton(true);
        }
    };

    peerConnection.onconnectionstatechange = () => {
        if (!peerConnection) return;

        const state = peerConnection.connectionState;
        if (state === 'connected') {
            updateStatus('Connected!', 'connected');
            showHelp('RTCDataChannel traffic is now flowing directly between the two browsers.', 'success');
            setRetryButton(false);
        } else if (state === 'failed') {
            updateStatus('WebRTC connection failed.', 'error');
            setRetryButton(true);
        }
    };

    peerConnection.ondatachannel = (event) => {
        dataChannel = event.channel;
        setupDataChannel();
    };

    return peerConnection;
}

async function flushPendingCandidates() {
    if (!peerConnection || !peerConnection.remoteDescription) return;

    while (pendingRemoteCandidates.length > 0) {
        const candidate = pendingRemoteCandidates.shift();
        await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    }
}

async function startWebRTCHandshake() {
    if (myRole !== 'host' || !peerPresent || offerInProgress || isDataChannelOpen()) return;

    offerInProgress = true;
    resetRtcState();
    const connection = createPeerConnection();
    dataChannel = connection.createDataChannel('control');
    setupDataChannel();

    try {
        updateStatus('Creating offer…');
        const offer = await connection.createOffer();
        await connection.setLocalDescription(offer);
        sendSignal({ type: 'offer', offer });
    } catch (error) {
        console.error('Offer creation failed', error);
        updateStatus('Failed to create the WebRTC offer.', 'error');
        showHelp('The host could not start negotiation. Reload the room and try again.', 'error');
        setRetryButton(true);
        offerInProgress = false;
    }
}

async function handleOffer(offer) {
    resetRtcState();
    const connection = createPeerConnection();

    updateStatus('Offer received. Creating answer…');
    await connection.setRemoteDescription(new RTCSessionDescription(offer));
    await flushPendingCandidates();

    const answer = await connection.createAnswer();
    await connection.setLocalDescription(answer);
    sendSignal({ type: 'answer', answer });
}

async function handleAnswer(answer) {
    if (!peerConnection) return;

    await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
    await flushPendingCandidates();
}

async function handleCandidate(candidate) {
    if (!candidate) return;

    if (!peerConnection || !peerConnection.remoteDescription) {
        pendingRemoteCandidates.push(candidate);
        return;
    }

    try {
        await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (error) {
        console.error('ICE candidate error', error);
    }
}

function setupDataChannel() {
    if (!dataChannel) return;

    dataChannel.onopen = () => {
        offerInProgress = false;
        updateStatus('Connected!', 'connected');
        showHelp('The direct RTCDataChannel is open. Pointer events now bypass the signaling server.', 'success');
        setRetryButton(false);

        if (myRole === 'host') {
            qrDiv.classList.add('hidden');
        } else if (myRole === 'client') {
            initPhoneTouchpad();
            phoneInstruction.textContent = 'Press and hold the pad, then tilt the phone to steer the laser';
            updateMotionButton();
        }
    };

    dataChannel.onclose = () => {
        if (peerPresent) {
            updateStatus('Data channel closed. Retry this room.', 'error');
            showHelp('The peer-to-peer channel closed after negotiation. Rejoin the same room or switch networks and try again.', 'warn');
            setRetryButton(true);
        }
    };

    dataChannel.onmessage = (event) => {
        if (myRole !== 'host') return;

        try {
            const msg = JSON.parse(event.data);
            if (msg.type === 'pointer') {
                laser.active = msg.active;
                if (msg.active) {
                    laser.x = msg.x;
                    laser.y = msg.y;
                }
            }
        } catch {
            // Ignore invalid data channel payloads.
        }
    };
}

function connectSignaling() {
    if (requestedRole === 'client' && !roomId) {
        updateStatus('Invalid client link.', 'error');
        renderPanels();
        showHelp('This join link is missing a room id. Re-scan the QR code from the host.', 'error');
        setRetryButton(true, 'Open host page');
        updateSessionMeta('Missing room');
        return;
    }

    const wsProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${wsProtocol}//${location.host}`);

    ws.onopen = () => {
        updateStatus('Signaling connected. Joining room…');
        updateSessionMeta();
        sendSignal({ type: 'join', room: roomId, requestedRole });
    };

    ws.onmessage = async (event) => {
        const data = JSON.parse(event.data);

        try {
            switch (data.type) {
                case 'joined':
                    myRole = data.role;
                    peerPresent = Boolean(data.peerPresent);
                    updateAddressBar();
                    renderPanels();
                    updateSessionMeta();
                    setDefaultHelp();
                    setRetryButton(false);

                    if (myRole === 'host') {
                        initHostRenderer();
                        updateStatus(peerPresent ? 'Peer detected. Waiting to negotiate…' : 'Waiting for phone to join this room…');
                        await showQRCode();
                    } else {
                        updateStatus(peerPresent ? 'Host is ready. Waiting for offer…' : 'Joined room. Waiting for host…');
                    }
                    break;

                case 'peer_ready':
                    peerPresent = true;
                    updateSessionMeta();
                    if (myRole === 'host') {
                        updateStatus('Phone joined. Starting WebRTC handshake…');
                        showHelp('The signaling server found both peers. The host is now creating the offer and ICE candidates.', 'info');
                        await startWebRTCHandshake();
                    } else {
                        updateStatus('Host is ready. Waiting for offer…');
                        showHelp('Both peers are now present. The host should send an offer momentarily.', 'info');
                    }
                    break;

                case 'peer_left':
                    peerPresent = false;
                    updateSessionMeta();
                    resetRtcState();
                    setRetryButton(false);

                    if (myRole === 'host') {
                        qrDiv.classList.remove('hidden');
                        updateStatus('Controller disconnected. Waiting for another device…');
                        showHelp('The room is still active. Re-scan the same QR code or reopen the join URL to reconnect.', 'warn');
                        await showQRCode();
                    } else {
                        updateStatus('Host disconnected. Reload after the host recreates the room.', 'error');
                        showHelp('The room link still exists, but the desktop host left. Ask the host to reopen the room, then retry.', 'warn');
                        setRetryButton(true);
                    }
                    break;

                case 'offer':
                    await handleOffer(data.offer);
                    break;

                case 'answer':
                    await handleAnswer(data.answer);
                    break;

                case 'candidate':
                    await handleCandidate(data.candidate);
                    break;

                case 'error':
                    updateStatus('Error: ' + data.message, 'error');
                    showHelp(data.message, 'error');
                    setRetryButton(true);
                    break;
            }
        } catch (error) {
            console.error('Signaling handler failed', error);
            updateStatus('A signaling step failed. Retry the room.', 'error');
            showHelp('One of the negotiation steps failed unexpectedly. Reload both peers and try the same room again.', 'error');
            setRetryButton(true);
        }
    };

    ws.onclose = () => {
        if (isDataChannelOpen()) {
            showHelp('Signaling disconnected, but the direct RTCDataChannel may keep working until one peer leaves.', 'warn');
            return;
        }

        updateStatus('Signaling disconnected.', 'error');
        showHelp('The WebSocket signaling server is unreachable. If you are using a public deployment, confirm it supports WebSockets over HTTPS/WSS.', 'error');
        setRetryButton(true, 'Reload session');
    };
}

function initHostRenderer() {
    if (hostRendererStarted) return;
    hostRendererStarted = true;

    const ctx = canvas.getContext('2d');
    catImg = new Image();
    catImg.src = 'cat.svg';

    function resize() {
        canvas.width = canvas.clientWidth;
        canvas.height = canvas.clientHeight;
    }

    window.addEventListener('resize', resize);
    resize();

    function draw() {
        const w = canvas.width;
        const h = canvas.height;

        ctx.fillStyle = '#0f0f1a';
        ctx.fillRect(0, 0, w, h);

        const targetX = laser.x * w;
        const targetY = laser.y * h;

        if (laser.active) {
            cat.x += (laser.x - cat.x) * CAT_LERP;
            cat.y += (laser.y - cat.y) * CAT_LERP;
        }

        const catPx = cat.x * w;
        const catPy = cat.y * h;

        if (laser.active) {
            const glow = ctx.createRadialGradient(targetX, targetY, 0, targetX, targetY, 18);
            glow.addColorStop(0, 'rgba(255, 50, 50, 1)');
            glow.addColorStop(0.3, 'rgba(255, 50, 50, 0.6)');
            glow.addColorStop(1, 'rgba(255, 50, 50, 0)');
            ctx.fillStyle = glow;
            ctx.beginPath();
            ctx.arc(targetX, targetY, 18, 0, Math.PI * 2);
            ctx.fill();

            ctx.fillStyle = '#ff4444';
            ctx.beginPath();
            ctx.arc(targetX, targetY, 4, 0, Math.PI * 2);
            ctx.fill();
        }

        if (catImg.complete) {
            ctx.drawImage(catImg, catPx - CAT_SIZE / 2, catPy - CAT_SIZE / 2, CAT_SIZE, CAT_SIZE);
        }

        requestAnimationFrame(draw);
    }

    requestAnimationFrame(draw);
}

function initPhoneTouchpad() {
    if (touchpadInitialized) return;
    touchpadInitialized = true;

    ensureMotionListener();
    startControlLoop();
    updateTouchDotPosition();
    updateMotionButton();

    async function activateTouchControl(event) {
        event.preventDefault();
        await beginLaserControl();
    }

    function preventWhileActive(event) {
        if (controlActive) {
            event.preventDefault();
        }
    }

    touchpad.addEventListener('touchstart', activateTouchControl);
    touchpad.addEventListener('touchmove', preventWhileActive);
    touchpad.addEventListener('touchend', (event) => {
        event.preventDefault();
        endLaserControl();
    });
    touchpad.addEventListener('touchcancel', (event) => {
        event.preventDefault();
        endLaserControl();
    });

    motionBtn.addEventListener('click', async () => {
        await requestMotionPermission();
    });

    let mouseDown = false;

    function updateMousePointer(event) {
        const rect = touchpad.getBoundingClientRect();
        controlPointer.x = clamp((event.clientX - rect.left) / rect.width, 0, 1);
        controlPointer.y = clamp((event.clientY - rect.top) / rect.height, 0, 1);
        updateTouchDotPosition();
        sendPointerState(true);
    }

    touchpad.addEventListener('mousedown', async (event) => {
        mouseDown = true;
        const started = await beginLaserControl();
        if (!started && typeof DeviceOrientationEvent !== 'undefined') {
            mouseDown = false;
            return;
        }
        updateMousePointer(event);
    });

    touchpad.addEventListener('mousemove', (event) => {
        if (mouseDown && !latestTilt.hasReading) {
            updateMousePointer(event);
        }
    });

    touchpad.addEventListener('mouseup', () => {
        mouseDown = false;
        endLaserControl();
    });

    touchpad.addEventListener('mouseleave', () => {
        if (mouseDown) {
            mouseDown = false;
            endLaserControl();
        }
    });
}

function handleRetry() {
    if (requestedRole === 'client' && !roomId) {
        location.href = location.origin + location.pathname;
        return;
    }
    location.reload();
}

window.addEventListener('load', () => {
    renderPanels();
    updateSessionMeta();
    setDefaultHelp();
    updateAddressBar();
    retryBtn.addEventListener('click', handleRetry);
    connectSignaling();
});

window.addEventListener('beforeunload', () => {
    sendSignal({ type: 'leave' });
});
