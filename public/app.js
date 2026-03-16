var statusDiv = document.getElementById('status');
var retryBtn = document.getElementById('retry-btn');
var hostPanel = document.getElementById('host-panel');
var phonePanel = document.getElementById('phone-panel');
var qrDiv = document.getElementById('qr');
var canvas = document.getElementById('arena');
var touchpad = document.getElementById('touchpad');
var touchDot = document.getElementById('touch-dot');

var ws;
var peerConnection;
var dataChannel;
var myRole = null;
var peerPresent = false;
var pendingCandidates = [];
var hostRendererStarted = false;
var touchpadReady = false;

var params = new URLSearchParams(location.search);
var requestedRole = params.get('role') === 'client' ? 'client' : 'host';
var roomId = params.get('room') || '';

if (roomId && !/^[a-zA-Z0-9_-]{4,32}$/.test(roomId)) roomId = '';
if (!roomId && requestedRole === 'host') {
    roomId = Math.random().toString(36).slice(2, 10);
}

var laser = { x: 0.5, y: 0.5, active: false };
var cat = { x: 0.5, y: 0.5 };
var catImg = null;
var CAT_LERP = 0.06;
var CAT_SIZE = 64;

var servers = {
    iceServers: [{
        urls: 'stun:stun.l.google.com:19302'
    }]
};

// ── Helpers ──

function setStatus(msg, state) {
    statusDiv.textContent = msg;
    statusDiv.className = 'status' + (state ? ' ' + state : '');
}

function showRetry(show) {
    retryBtn.classList.toggle('hidden', !show);
}

function showPanels() {
    var role = myRole || requestedRole;
    hostPanel.classList.toggle('hidden', role !== 'host');
    phonePanel.classList.toggle('hidden', role !== 'client');
}

function updateUrl() {
    var url = new URL(location.href);
    url.searchParams.set('room', roomId);
    if (requestedRole === 'client') url.searchParams.set('role', 'client');
    else url.searchParams.delete('role');
    history.replaceState({}, '', url);
}

function wsSend(obj) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(obj));
    }
}

function dcOpen() {
    return dataChannel && dataChannel.readyState === 'open';
}

// ── QR Code ──

async function getJoinUrl() {
    var origin = location.origin;
    if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
        var res = await fetch('/ip');
        var data = await res.json();
        var ip = data.ips.find(function (ip) { return ip !== 'localhost'; });
        if (ip) origin = 'http://' + ip + ':' + location.port;
    }
    return origin + '/?room=' + roomId + '&role=client';
}

async function showQR() {
    try {
        var url = await getJoinUrl();
        var res = await fetch('/qr?url=' + encodeURIComponent(url));
        var img = await res.text();
        qrDiv.classList.remove('hidden');
        qrDiv.innerHTML = '<p>Scan to connect</p>' + img + '<p class="qr-url">' + url + '</p>';
    } catch (e) {
        console.error(e);
        qrDiv.innerHTML = '<p>Could not generate QR code</p>';
    }
}

// ── WebRTC ──

function cleanupRTC() {
    pendingCandidates = [];
    if (dataChannel) {
        dataChannel.onopen = dataChannel.onclose = dataChannel.onmessage = null;
        if (dataChannel.readyState !== 'closed') dataChannel.close();
        dataChannel = null;
    }
    if (peerConnection) {
        peerConnection.onicecandidate = null;
        peerConnection.oniceconnectionstatechange = null;
        peerConnection.onconnectionstatechange = null;
        peerConnection.ondatachannel = null;
        if (peerConnection.signalingState !== 'closed') peerConnection.close();
        peerConnection = null;
    }
}

function makePeerConnection() {
    if (peerConnection) return peerConnection;

    peerConnection = new RTCPeerConnection(servers);

    peerConnection.onicecandidate = function (e) {
        if (e.candidate) wsSend({ type: 'candidate', candidate: e.candidate });
    };

    peerConnection.oniceconnectionstatechange = function () {
        if (!peerConnection) return;
        var s = peerConnection.iceConnectionState;
        if (s === 'connected' || s === 'completed') setStatus('Connected!', 'ok');
        if (s === 'disconnected') { setStatus('Disconnected.', 'err'); showRetry(true); }
        if (s === 'failed') { setStatus('Connection failed.', 'err'); showRetry(true); }
    };

    peerConnection.onconnectionstatechange = function () {
        if (!peerConnection) return;
        if (peerConnection.connectionState === 'connected') {
            setStatus('Connected!', 'ok');
            showRetry(false);
        }
        if (peerConnection.connectionState === 'failed') {
            setStatus('Connection failed.', 'err');
            showRetry(true);
        }
    };

    peerConnection.ondatachannel = function (e) {
        dataChannel = e.channel;
        setupDataChannel();
    };

    return peerConnection;
}

async function flushCandidates() {
    if (!peerConnection || !peerConnection.remoteDescription) return;
    while (pendingCandidates.length) {
        await peerConnection.addIceCandidate(new RTCIceCandidate(pendingCandidates.shift()));
    }
}

async function startOffer() {
    if (myRole !== 'host' || !peerPresent || dcOpen()) return;
    cleanupRTC();
    var pc = makePeerConnection();
    dataChannel = pc.createDataChannel('control');
    setupDataChannel();
    setStatus('Starting connection...');
    var offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    wsSend({ type: 'offer', offer: offer });
}

async function handleOffer(offer) {
    cleanupRTC();
    var pc = makePeerConnection();
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    await flushCandidates();
    var answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    wsSend({ type: 'answer', answer: answer });
}

async function handleAnswer(answer) {
    if (!peerConnection) return;
    await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
    await flushCandidates();
}

async function handleCandidate(candidate) {
    if (!candidate) return;
    if (!peerConnection || !peerConnection.remoteDescription) {
        pendingCandidates.push(candidate);
        return;
    }
    try { await peerConnection.addIceCandidate(new RTCIceCandidate(candidate)); }
    catch (e) { console.error('ICE error', e); }
}

function setupDataChannel() {
    if (!dataChannel) return;

    dataChannel.onopen = function () {
        setStatus('Connected!', 'ok');
        showRetry(false);
        if (myRole === 'host') qrDiv.classList.add('hidden');
        if (myRole === 'client') initTouchpad();
    };

    dataChannel.onclose = function () {
        if (peerPresent) { setStatus('Disconnected.', 'err'); showRetry(true); }
    };

    dataChannel.onmessage = function (e) {
        if (myRole !== 'host') return;
        try {
            var msg = JSON.parse(e.data);
            if (msg.type === 'pointer') {
                laser.active = msg.active;
                if (msg.active) { laser.x = msg.x; laser.y = msg.y; }
            }
        } catch (err) { /* ignore */ }
    };
}

// ── Signaling ──

function connectSignaling() {
    if (requestedRole === 'client' && !roomId) {
        setStatus('Bad link. Scan the QR again.', 'err');
        showPanels();
        return;
    }

    var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(proto + '//' + location.host);

    ws.onopen = function () {
        setStatus('Joining room...');
        wsSend({ type: 'join', room: roomId, requestedRole: requestedRole });
    };

    ws.onmessage = async function (e) {
        var data = JSON.parse(e.data);

        switch (data.type) {
            case 'joined':
                myRole = data.role;
                peerPresent = !!data.peerPresent;
                updateUrl();
                showPanels();
                showRetry(false);
                if (myRole === 'host') {
                    initRenderer();
                    setStatus(peerPresent ? 'Phone found. Connecting...' : 'Waiting for phone...');
                    await showQR();
                } else {
                    setStatus(peerPresent ? 'Host ready. Waiting for offer...' : 'Waiting for host...');
                }
                break;
            case 'peer_ready':
                peerPresent = true;
                if (myRole === 'host') { setStatus('Phone joined. Connecting...'); await startOffer(); }
                else setStatus('Host ready. Waiting for offer...');
                break;
            case 'peer_left':
                peerPresent = false;
                cleanupRTC();
                showRetry(false);
                if (myRole === 'host') {
                    qrDiv.classList.remove('hidden');
                    setStatus('Phone left. Waiting...');
                    await showQR();
                } else {
                    setStatus('Host left.', 'err');
                    showRetry(true);
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
                setStatus(data.message, 'err');
                showRetry(true);
                break;
        }
    };

    ws.onclose = function () {
        if (!dcOpen()) { setStatus('Server disconnected.', 'err'); showRetry(true); }
    };
}

// ── Host: Canvas ──

function initRenderer() {
    if (hostRendererStarted) return;
    hostRendererStarted = true;

    var ctx = canvas.getContext('2d');
    catImg = new Image();
    catImg.src = 'cat.png';

    function resize() {
        canvas.width = canvas.clientWidth;
        canvas.height = canvas.clientHeight;
    }
    window.addEventListener('resize', resize);
    resize();

    function draw() {
        var w = canvas.width, h = canvas.height;
        ctx.fillStyle = '#110f0d';
        ctx.fillRect(0, 0, w, h);

        var lx = laser.x * w, ly = laser.y * h;

        if (laser.active) {
            cat.x += (laser.x - cat.x) * CAT_LERP;
            cat.y += (laser.y - cat.y) * CAT_LERP;
        }

        var cx = cat.x * w, cy = cat.y * h;

        if (laser.active) {
            var g = ctx.createRadialGradient(lx, ly, 0, lx, ly, 18);
            g.addColorStop(0, 'rgba(255,50,50,1)');
            g.addColorStop(0.3, 'rgba(255,50,50,0.6)');
            g.addColorStop(1, 'rgba(255,50,50,0)');
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(lx, ly, 18, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#ff4444';
            ctx.beginPath();
            ctx.arc(lx, ly, 4, 0, Math.PI * 2);
            ctx.fill();
        }

        if (catImg.complete) {
            ctx.drawImage(catImg, cx - CAT_SIZE / 2, cy - CAT_SIZE / 2, CAT_SIZE, CAT_SIZE);
        }

        requestAnimationFrame(draw);
    }
    requestAnimationFrame(draw);
}

// ── Phone: Touchpad ──

function initTouchpad() {
    if (touchpadReady) return;
    touchpadReady = true;

    function send(x, y, active) {
        if (dcOpen()) dataChannel.send(JSON.stringify({ type: 'pointer', x: x, y: y, active: active }));
        if (active) {
            touchDot.classList.remove('hidden');
            touchDot.style.left = (x * 100) + '%';
            touchDot.style.top = (y * 100) + '%';
        } else {
            touchDot.classList.add('hidden');
        }
    }

    function coords(touch) {
        var r = touchpad.getBoundingClientRect();
        return {
            x: Math.max(0, Math.min(1, (touch.clientX - r.left) / r.width)),
            y: Math.max(0, Math.min(1, (touch.clientY - r.top) / r.height))
        };
    }

    function off() {
        if (dcOpen()) dataChannel.send(JSON.stringify({ type: 'pointer', active: false }));
        touchDot.classList.add('hidden');
    }

    touchpad.addEventListener('touchstart', function (e) { e.preventDefault(); var c = coords(e.touches[0]); send(c.x, c.y, true); });
    touchpad.addEventListener('touchmove', function (e) { e.preventDefault(); var c = coords(e.touches[0]); send(c.x, c.y, true); });
    touchpad.addEventListener('touchend', function (e) { e.preventDefault(); off(); });
    touchpad.addEventListener('touchcancel', function (e) { e.preventDefault(); off(); });

    var down = false;
    touchpad.addEventListener('mousedown', function (e) { down = true; var c = coords(e); send(c.x, c.y, true); });
    touchpad.addEventListener('mousemove', function (e) { if (down) { var c = coords(e); send(c.x, c.y, true); } });
    touchpad.addEventListener('mouseup', function () { down = false; off(); });
    touchpad.addEventListener('mouseleave', function () { if (down) { down = false; off(); } });
}

// ── Boot ──

window.addEventListener('load', function () {
    showPanels();
    updateUrl();
    retryBtn.addEventListener('click', function () { location.reload(); });
    connectSignaling();
});

window.addEventListener('beforeunload', function () {
    wsSend({ type: 'leave' });
});
