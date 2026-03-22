// dom refs
var statusDiv        = document.getElementById('status');
var retryBtn         = document.getElementById('retry-btn');
var hostPanel        = document.getElementById('host-panel');
var phonePanel       = document.getElementById('phone-panel');
var qrDiv            = document.getElementById('qr');
var canvas           = document.getElementById('arena');
var touchpad         = document.getElementById('touchpad');
var touchDot         = document.getElementById('touch-dot');
var phoneInstruction = document.getElementById('phone-instruction');
var phoneSub         = document.getElementById('phone-sub');
var phoneActions     = document.getElementById('phone-actions');
var btnStartSensors  = document.getElementById('btn-start-sensors');
var holdZone         = document.getElementById('hold-zone');
var hostHint         = document.getElementById('host-hint');

// url roles
var params        = new URLSearchParams(location.search);
var requestedRole = params.get('role') === 'client' ? 'client' : 'host';
var hostPeerId = params.get('host') || params.get('room') || '';

// connection state
var socket, peer;
var myRole              = null;
var peerPresent         = false;
var hostClientId        = null;
var hostRendererStarted = false;
var phoneUiBound        = false;

var ICE_SERVERS = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

// laser / cat rendering state
var laser        = { x: 0.5, y: 0.5, active: false };
var laserTargetX = 0.5, laserTargetY = 0.5;
var LASER_SMOOTH = 0.22;

var cat      = { x: 0.5, y: 0.5 };
var catImg   = null;
var CAT_LERP = 0.06;
var CAT_SIZE = 64;

var catJump       = 0, catJumpTarget = 0;
var lastJumpAt    = 0;
var JUMP_DECAY_MS = 380;
var JUMP_MAX_PX   = 100;

// microphone state
var MIC_RMS_GATE    = 0.022;
var MIC_RMS_TO_FULL = 0.12;
var micEnabled  = false, micStream = null;
var audioCtx    = null, analyser = null, micData = null;
var smoothedJump = 0,   micRaf   = null;

// tilt / touch state
var tiltBaseline         = null;
var TILT_HALF_SPAN_DEG_X = 22;
var TILT_HALF_SPAN_DEG_Y = 22;
var tiltReady    = false, holdActive   = false, touchDragging = false;
var lastNormX    = 0.5,   lastNormY    = 0.5;
var lastSendTime = 0,     SEND_MS      = 50;
var orientationHandler = null;

// helpers
function setStatus(msg, state) {
    statusDiv.textContent = msg;
    statusDiv.className   = 'status' + (state ? ' ' + state : '');
}

function showRetry(show) { retryBtn.classList.toggle('hidden', !show); }

function showPanels() {
    var role = myRole || requestedRole;
    hostPanel.classList.toggle('hidden', role !== 'host');
    phonePanel.classList.toggle('hidden', role !== 'client');
}

function setPhoneSub(text) {
    if (!phoneSub) return;
    phoneSub.textContent = text || '';
    phoneSub.classList.toggle('hidden', !text);
}

function updateUrl() {
    var url = new URL(location.href);
    url.searchParams.delete('room');
    if (hostPeerId) url.searchParams.set('host', hostPeerId);
    else url.searchParams.delete('host');
    if (requestedRole === 'client') url.searchParams.set('role', 'client'); else url.searchParams.delete('role');
    history.replaceState({}, '', url);
}

function peerConnected() { return peer && !peer.destroyed && peer.connected; }

function decodePeerData(data) {
    if (typeof data === 'string') return data;
    try { return new TextDecoder().decode(data); } catch (e) { return ''; }
}

function cleanupPeer() {
    if (peer) { try { peer.destroy(); } catch (e) { /* ignore */ } peer = null; }
}

// sensor / mic cleanup
function cleanupPhoneSensors() {
    if (micRaf) { cancelAnimationFrame(micRaf); micRaf = null; }
    if (orientationHandler) {
        window.removeEventListener('deviceorientation', orientationHandler);
        orientationHandler = null;
    }
    tiltReady = holdActive = touchDragging = false;
    tiltBaseline = null;

    if (micStream) { micStream.getTracks().forEach(function (t) { t.stop(); }); micStream = null; }
    micEnabled   = false;
    smoothedJump = 0;
    if (audioCtx && audioCtx.state !== 'closed') { audioCtx.close().catch(function () {}); }
    audioCtx = analyser = micData = null;

    if (holdZone) holdZone.classList.add('hidden');
    if (touchpad) touchpad.classList.remove('hidden');
    if (btnStartSensors) { btnStartSensors.disabled = false; btnStartSensors.textContent = 'Allow tilt & microphone'; }
    setPhoneSub('');
}

// microphone analysis
function startMicAnalysisFromStream(stream) {
    if (micRaf) { cancelAnimationFrame(micRaf); micRaf = null; }
    if (audioCtx && audioCtx.state !== 'closed') { audioCtx.close().catch(function () {}); }

    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    analyser  = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.85;
    audioCtx.createMediaStreamSource(stream).connect(analyser);
    micData      = new Uint8Array(analyser.fftSize);
    micEnabled   = true;
    smoothedJump = 0;

    function rmsToGatedJump(rms) {
        if (rms <= MIC_RMS_GATE) return 0;
        var t = (rms - MIC_RMS_GATE) / Math.max(0.04, MIC_RMS_TO_FULL - MIC_RMS_GATE);
        return Math.max(0, Math.min(1, t));
    }

    function micTick() {
        if (!micEnabled || !analyser || !micData) return;
        micRaf = requestAnimationFrame(micTick);
        analyser.getByteTimeDomainData(micData);
        var sum = 0;
        for (var i = 0; i < micData.length; i++) { var v = (micData[i] - 128) / 128; sum += v * v; }
        smoothedJump += (rmsToGatedJump(Math.sqrt(sum / micData.length)) - smoothedJump) * 0.28;
        sendPointer(false);
    }

    if (audioCtx.state === 'suspended') {
        audioCtx.resume().then(function () { micRaf = requestAnimationFrame(micTick); }).catch(function () { micRaf = requestAnimationFrame(micTick); });
    } else {
        micRaf = requestAnimationFrame(micTick);
    }
}

// pointer send
function sendPointer(force) {
    if (!peerConnected()) return;
    var t = Date.now();
    if (!force && t - lastSendTime < SEND_MS) return;
    lastSendTime = t;
    var active = tiltReady ? holdActive : touchDragging;
    var msg    = { type: 'pointer', active: active, x: lastNormX, y: lastNormY };
    if (micEnabled) msg.jump = smoothedJump;
    peer.send(JSON.stringify(msg));
}

// QR join URL
async function getJoinUrl() {
    var hostport = location.host;
    if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
        var data = await (await fetch('/ip')).json();
        var ip   = data.ips.find(function (x) { return x !== 'localhost'; });
        if (ip) hostport = ip + ':' + location.port;
    }
    return 'https://' + hostport + '/?host=' + encodeURIComponent(hostPeerId) + '&role=client';
}

async function showQR() {
    try {
        var url = await getJoinUrl();
        var img = await (await fetch('/qr?url=' + encodeURIComponent(url))).text();
        qrDiv.classList.remove('hidden');
        qrDiv.innerHTML = '<p>Scan to connect</p>' + img + '<p class="qr-url">' + url + '</p>';
    } catch (e) {
        console.error(e);
        qrDiv.innerHTML = '<p>Could not generate QR code</p>';
    }
}

// webrtc peers
function startHostPeer(clientId) {
    cleanupPeer();
    hostClientId = clientId;
    setStatus('Phone joined. Connecting...');

    peer = new SimplePeer({ initiator: true, config: ICE_SERVERS });

    peer.on('signal', function (data) { socket.emit('signal', hostClientId, data); });

    peer.on('connect', function () {
        setStatus('Connected!', 'ok');
        showRetry(false);
        qrDiv.classList.add('hidden');
    });

    peer.on('close', function () {
        if (peerPresent) { setStatus('Disconnected.', 'err'); showRetry(true); }
    });

    peer.on('error', function (err) {
        console.error(err);
        setStatus('Connection failed.', 'err');
        showRetry(true);
    });

    peer.on('data', function (data) {
        if (myRole !== 'host') return;
        try {
            var msg = JSON.parse(decodePeerData(data));
            if (msg.type !== 'pointer') return;
            laser.active = !!msg.active;
            if (msg.active && typeof msg.x === 'number' && typeof msg.y === 'number') {
                laserTargetX = msg.x;
                laserTargetY = msg.y;
            }
            if (typeof msg.jump === 'number' && !isNaN(msg.jump)) {
                catJumpTarget = Math.max(0, Math.min(1, msg.jump));
                lastJumpAt    = Date.now();
            }
        } catch (e) { /* ignore */ }
    });
}

function ensureClientPeer() {
    if (peer) return peer;
    peer = new SimplePeer({ initiator: false, config: ICE_SERVERS });

    peer.on('signal', function (data) { socket.emit('signal', hostPeerId, data); });

    peer.on('connect', function () {
        setStatus('Connected!', 'ok');
        showRetry(false);
        initPhoneControls();
    });

    peer.on('close', function () {
        if (peerPresent) { setStatus('Disconnected.', 'err'); showRetry(true); }
    });

    peer.on('error', function (err) {
        console.error(err);
        setStatus('Connection failed.', 'err');
        showRetry(true);
    });

    return peer;
}

// signaling
function connectSignaling() {
    if (requestedRole === 'client' && !hostPeerId) {
        setStatus('Bad link. Scan the QR again.', 'err');
        showPanels();
        return;
    }

    socket = io();

    socket.on('connect', function () {
        if (requestedRole === 'host') {
            hostPeerId = socket.id;
            myRole = 'host';
            updateUrl();
            showPanels();
            if (hostHint) hostHint.classList.remove('hidden');
            initRenderer();
            setStatus('Waiting for phone...');
            showRetry(false);
            showQR();
        } else {
            myRole = 'client';
            peerPresent = true;
            showPanels();
            setStatus('Connecting to host...');
            socket.emit('pairWith', hostPeerId);
        }
    });

    socket.on('peer_ready', function (payload) {
        if (myRole !== 'host' || !payload || !payload.clientId) return;
        peerPresent = true;
        startHostPeer(payload.clientId);
    });

    socket.on('signal', function (signal, fromId) {
        if (myRole === 'host') {
            if (fromId !== hostClientId || !peer) return;
            peer.signal(signal);
        } else {
            if (fromId !== hostPeerId) return;
            ensureClientPeer().signal(signal);
        }
    });

    socket.on('peer_left', function () {
        peerPresent    = false;
        hostClientId   = null;
        cleanupPeer();
        if (myRole === 'client') cleanupPhoneSensors();
        showRetry(false);
        if (myRole === 'host') {
            qrDiv.classList.remove('hidden');
            setStatus('Phone left. Waiting...');
            showQR();
        } else {
            setStatus('Host left.', 'err');
            showRetry(true);
        }
    });

    socket.on('pair_error', function (payload) {
        peerPresent = false;
        setStatus((payload && payload.message) || 'Could not connect.', 'err');
        showRetry(true);
    });

    socket.on('disconnect', function () {
        if (!peerConnected()) { setStatus('Server disconnected.', 'err'); showRetry(true); }
    });
}

// host renderer
function initRenderer() {
    if (hostRendererStarted) return;
    hostRendererStarted = true;

    var ctx = canvas.getContext('2d');
    catImg = new Image();
    catImg.src = 'cat.svg';

    function resize() { canvas.width = canvas.clientWidth; canvas.height = canvas.clientHeight; }
    window.addEventListener('resize', resize);
    resize();

    function draw() {
        var w = canvas.width, h = canvas.height;
        ctx.fillStyle = '#110f0d';
        ctx.fillRect(0, 0, w, h);

        // Jump decay when no fresh mic signal
        if (Date.now() - lastJumpAt > JUMP_DECAY_MS) {
            catJumpTarget *= 0.92;
            if (catJumpTarget < 0.015) catJumpTarget = 0;
        }
        catJump += (catJumpTarget - catJump) * 0.18;

        // Smooth laser toward target
        laser.x += (laserTargetX - laser.x) * LASER_SMOOTH;
        laser.y += (laserTargetY - laser.y) * LASER_SMOOTH;

        var lx = laser.x * w, ly = laser.y * h;

        // Cat chases laser
        if (laser.active) {
            cat.x += (laser.x - cat.x) * CAT_LERP;
            cat.y += (laser.y - cat.y) * CAT_LERP;
        }

        var cx     = cat.x * w;
        var cy     = cat.y * h;
        var jumpPx = catJump * JUMP_MAX_PX;

        // Draw laser dot
        if (laser.active) {
            var g = ctx.createRadialGradient(lx, ly, 0, lx, ly, 18);
            g.addColorStop(0,   'rgba(255,50,50,1)');
            g.addColorStop(0.3, 'rgba(255,50,50,0.6)');
            g.addColorStop(1,   'rgba(255,50,50,0)');
            ctx.fillStyle = g;
            ctx.beginPath(); ctx.arc(lx, ly, 18, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#ff4444';
            ctx.beginPath(); ctx.arc(lx, ly, 4,  0, Math.PI * 2); ctx.fill();
        }

        // Draw cat
        if (catImg.complete) {
            ctx.drawImage(catImg, cx - CAT_SIZE / 2, cy - CAT_SIZE / 2 - jumpPx, CAT_SIZE, CAT_SIZE);
        }

        requestAnimationFrame(draw);
    }
    requestAnimationFrame(draw);
}

// tilt helpers
function clamp01(v) { return Math.max(0, Math.min(1, v)); }

function tiltDeltaXDeg(cur, base) {
    var d = cur - base;
    if (d >  90) d -= 180;
    if (d < -90) d += 180;
    return d;
}

function tiltDeltaYDeg(cur, base) {
    var d = cur - base;
    if (d >  180) d -= 360;
    if (d < -180) d += 360;
    return d;
}

function mapTiltToNorm(ev) {
    var g = ev.gamma, b = ev.beta;
    if (g == null || b == null) return;

    var portrait = typeof window.matchMedia === 'function' && window.matchMedia('(orientation: portrait)').matches;
    var gx = portrait ? g : b;
    var gy = portrait ? b : g;

    if (tiltBaseline === null) {
        tiltBaseline = { gx: gx, gy: gy };
        lastNormX = lastNormY = 0.5;
        return;
    }

    var dgx, dgy;
    if (portrait) {
        dgx = tiltDeltaXDeg(gx, tiltBaseline.gx);
        dgy = tiltDeltaYDeg(gy, tiltBaseline.gy);
    } else {
        dgx = tiltDeltaYDeg(gx, tiltBaseline.gx);
        dgy = tiltDeltaXDeg(gy, tiltBaseline.gy);
    }

    lastNormX = clamp01(0.5 + (dgx / Math.max(8, TILT_HALF_SPAN_DEG_X)) * 0.5);
    lastNormY = clamp01(0.5 - (dgy / Math.max(8, TILT_HALF_SPAN_DEG_Y)) * 0.5);
}

// phone controls
function initPhoneControls() {
    if (phoneInstruction) {
        phoneInstruction.textContent = 'Drag the pad to move the laser, or tap "Allow tilt & microphone" once (HTTPS page).';
    }
    if (phoneActions) phoneActions.classList.remove('hidden');
    if (holdZone)    holdZone.classList.add('hidden');
    if (touchpad)    touchpad.classList.remove('hidden');
    if (phoneUiBound) return;
    phoneUiBound = true;

    // touchpad
    function coordsFromEvent(pt) {
        var r = touchpad.getBoundingClientRect();
        return {
            x: Math.max(0, Math.min(1, (pt.clientX - r.left) / r.width)),
            y: Math.max(0, Math.min(1, (pt.clientY - r.top)  / r.height))
        };
    }

    function onPadStart(e) {
        if (tiltReady) return;
        e.preventDefault();
        touchDragging = true;
        var c = coordsFromEvent(e.touches ? e.touches[0] : e);
        lastNormX = c.x; lastNormY = c.y;
        sendPointer(true);
        touchDot.classList.remove('hidden');
        touchDot.style.left = (c.x * 100) + '%';
        touchDot.style.top  = (c.y * 100) + '%';
    }

    function onPadMove(e) {
        if (tiltReady || !touchDragging) return;
        e.preventDefault();
        var c = coordsFromEvent(e.touches ? e.touches[0] : e);
        lastNormX = c.x; lastNormY = c.y;
        sendPointer(false);
        touchDot.style.left = (c.x * 100) + '%';
        touchDot.style.top  = (c.y * 100) + '%';
    }

    function onPadEnd(e) {
        if (tiltReady) return;
        if (e && e.cancelable) e.preventDefault();
        touchDragging = false;
        sendPointer(true);
        touchDot.classList.add('hidden');
    }

    touchpad.addEventListener('touchstart',  onPadStart, { passive: false });
    touchpad.addEventListener('touchmove',   onPadMove,  { passive: false });
    touchpad.addEventListener('touchend',    onPadEnd,   { passive: false });
    touchpad.addEventListener('touchcancel', onPadEnd,   { passive: false });
    touchpad.addEventListener('mousedown',   function (e) { if (!tiltReady) onPadStart(e); });
    touchpad.addEventListener('mousemove',   function (e) { if (!tiltReady && touchDragging) onPadMove(e); });
    touchpad.addEventListener('mouseup',     function ()  { if (!tiltReady) onPadEnd(); });
    touchpad.addEventListener('mouseleave',  function ()  { if (!tiltReady && touchDragging) onPadEnd(); });

    // hold zone (tilt mode)
    function onHoldStart(e) {
        if (!tiltReady) return;
        if (e.cancelable) e.preventDefault();
        holdActive   = true;
        tiltBaseline = null;
        sendPointer(true);
    }

    function onHoldEnd(e) {
        if (!tiltReady) return;
        if (e && e.cancelable) e.preventDefault();
        holdActive   = false;
        tiltBaseline = null;
        sendPointer(true);
    }

    if (holdZone) {
        holdZone.addEventListener('touchstart',  onHoldStart, { passive: false });
        holdZone.addEventListener('touchend',    onHoldEnd,   { passive: false });
        holdZone.addEventListener('touchcancel', onHoldEnd,   { passive: false });
        holdZone.addEventListener('mousedown',   onHoldStart);
        holdZone.addEventListener('mouseup',     onHoldEnd);
        holdZone.addEventListener('mouseleave',  onHoldEnd);
    }

    // tilt + mic enable button
    function applyTiltUiEnabled() {
        tiltReady = true;
        if (btnStartSensors) { btnStartSensors.disabled = true; btnStartSensors.textContent = 'Tilt & mic on'; }
        if (holdZone) holdZone.classList.remove('hidden');
        if (touchpad) touchpad.classList.add('hidden');
        if (phoneInstruction) {
            phoneInstruction.textContent = 'Hold the red zone to aim — your tilt at that moment is center. Release to stop.';
        }
        touchDragging = false;
        touchDot.classList.add('hidden');

        if (!orientationHandler) {
            orientationHandler = function (ev) {
                if (!tiltReady || !holdActive) return;
                mapTiltToNorm(ev);
                sendPointer(false);
            };
            window.addEventListener('deviceorientation', orientationHandler);
        }
    }

    if (btnStartSensors) {
        btnStartSensors.addEventListener('click', async function () {
            setPhoneSub('');

            if (!window.isSecureContext) {
                setPhoneSub('Page must be https:// for tilt and microphone. Touch still works.');
                return;
            }

            try {
                if (typeof DeviceOrientationEvent !== 'undefined' &&
                    typeof DeviceOrientationEvent.requestPermission === 'function') {
                    var state = await DeviceOrientationEvent.requestPermission();
                    if (state !== 'granted') {
                        setPhoneSub('Orientation permission denied. Touch still works.');
                        return;
                    }
                }

                if (typeof DeviceMotionEvent !== 'undefined' &&
                    typeof DeviceMotionEvent.requestPermission === 'function') {
                    try { await DeviceMotionEvent.requestPermission(); } catch (e) { /* optional */ }
                }

                if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
                    setPhoneSub('getUserMedia unavailable — use HTTPS. Touch still works.');
                    return;
                }

                micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
                startMicAnalysisFromStream(micStream);
                applyTiltUiEnabled();
            } catch (err) {
                console.error(err);
                var name = err && err.name;
                if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
                    setPhoneSub('Mic denied. Touch/tilt still work.');
                } else if (name === 'NotFoundError') {
                    setPhoneSub('No microphone found. Touch/tilt still work.');
                } else {
                    setPhoneSub((name ? name + ': ' : '') + (err.message || err) + ' Touch/tilt still work.');
                }
            }
        });
    }
}

// boot
window.addEventListener('load', function () {
    showPanels();
    if (requestedRole === 'client') updateUrl();
    retryBtn.addEventListener('click', function () { location.reload(); });
    connectSignaling();
});

window.addEventListener('beforeunload', function () {
    if (socket && socket.connected) socket.emit('leave');
});