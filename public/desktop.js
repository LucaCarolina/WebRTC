/**
 * Host / desktop — class “sender” pattern:
 * io(), wait for phone; on peer_ready start SimplePeer({ initiator: true }),
 * peer.on('signal', data => socket.emit('signal', peerId, data)).
 * Cat + laser UI live here only.
 */

var statusDiv = document.getElementById('status');
var retryBtn  = document.getElementById('retry-btn');
var hostPanel = document.getElementById('host-panel');
var qrDiv     = document.getElementById('qr');
var canvas    = document.getElementById('arena');
var hostHint  = document.getElementById('host-hint');

var hostPeerId = '';
var socket, peer;
var peerPresent  = false;
var hostClientId = null;
var hostRendererStarted = false;

var ICE_SERVERS = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

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

/** Red trail: 2s full opacity, then 1.5s linear fade; oldest points drop off first (follows cat path while laser is on). */
var TRAIL_FULL_MS       = 2000;
var TRAIL_FADE_MS       = 1500;
var TRAIL_MIN_DIST_NORM = 0.0015;

function setStatus(msg, state) {
    statusDiv.textContent = msg;
    statusDiv.className   = 'status' + (state ? ' ' + state : '');
}

function showRetry(show) { retryBtn.classList.toggle('hidden', !show); }

function updateUrl() {
    var url = new URL(location.href);
    url.searchParams.delete('room');
    if (hostPeerId) url.searchParams.set('host', hostPeerId);
    else url.searchParams.delete('host');
    url.searchParams.delete('role');
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

async function getJoinUrl() {
    var hostport = location.host;
    if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
        var data = await (await fetch('/ip')).json();
        var ip   = data.ips.find(function (x) { return x !== 'localhost'; });
        if (ip) hostport = ip + ':' + location.port;
    }
    return 'https://' + hostport + '/mobile.html?host=' + encodeURIComponent(hostPeerId) + '&role=client';
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

function startHostPeer(clientId) {
    cleanupPeer();
    hostClientId = clientId;
    setStatus('Phone joined. Connecting...');

    peer = new SimplePeer({ initiator: true, config: ICE_SERVERS });

    peer.on('signal', function (data) {
        socket.emit('signal', hostClientId, data);
    });

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

function initSocket() {
    socket = io();

    socket.on('connect', function () {
        hostPeerId = socket.id;
        updateUrl();
        if (hostHint) hostHint.classList.remove('hidden');
        hostPanel.classList.remove('hidden');
        initRenderer();
        setStatus('Waiting for phone...');
        showRetry(false);
        showQR();
    });

    socket.on('peer_ready', function (payload) {
        if (!payload || !payload.clientId) return;
        peerPresent = true;
        startHostPeer(payload.clientId);
    });

    socket.on('signal', function (signal, fromId) {
        if (fromId !== hostClientId || !peer) return;
        peer.signal(signal);
    });

    socket.on('peer_left', function () {
        peerPresent  = false;
        hostClientId = null;
        cleanupPeer();
        showRetry(false);
        qrDiv.classList.remove('hidden');
        setStatus('Phone left. Waiting...');
        showQR();
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

function initRenderer() {
    if (hostRendererStarted) return;
    hostRendererStarted = true;

    var ctx = canvas.getContext('2d');
    catImg = new Image();
    catImg.src = 'cat.svg';

    var trail           = [];
    var prevLaserActive = false;

    function trailPointAlpha(now, t) {
        var age = now - t;
        if (age <= TRAIL_FULL_MS) return 1;
        if (age >= TRAIL_FULL_MS + TRAIL_FADE_MS) return 0;
        return 1 - (age - TRAIL_FULL_MS) / TRAIL_FADE_MS;
    }

    function resize() { canvas.width = canvas.clientWidth; canvas.height = canvas.clientHeight; }
    window.addEventListener('resize', resize);
    resize();

    function draw() {
        var w = canvas.width, h = canvas.height;
        var now = performance.now();

        ctx.fillStyle = '#110f0d';
        ctx.fillRect(0, 0, w, h);

        if (Date.now() - lastJumpAt > JUMP_DECAY_MS) {
            catJumpTarget *= 0.92;
            if (catJumpTarget < 0.015) catJumpTarget = 0;
        }
        catJump += (catJumpTarget - catJump) * 0.18;

        laser.x += (laserTargetX - laser.x) * LASER_SMOOTH;
        laser.y += (laserTargetY - laser.y) * LASER_SMOOTH;

        var lx = laser.x * w, ly = laser.y * h;

        if (laser.active) {
            cat.x += (laser.x - cat.x) * CAT_LERP;
            cat.y += (laser.y - cat.y) * CAT_LERP;
        }

        if (laser.active) {
            if (!prevLaserActive) {
                trail.push({ x: cat.x, y: cat.y, t: now });
            } else if (trail.length) {
                var last = trail[trail.length - 1];
                var dx   = cat.x - last.x;
                var dy   = cat.y - last.y;
                if (dx * dx + dy * dy >= TRAIL_MIN_DIST_NORM * TRAIL_MIN_DIST_NORM) {
                    trail.push({ x: cat.x, y: cat.y, t: now });
                }
            } else {
                trail.push({ x: cat.x, y: cat.y, t: now });
            }
        }
        prevLaserActive = laser.active;

        while (trail.length && trailPointAlpha(now, trail[0].t) <= 0) {
            trail.shift();
        }

        ctx.save();
        ctx.lineCap  = 'round';
        ctx.lineJoin = 'round';
        ctx.lineWidth = 5;
        for (var i = 0; i < trail.length - 1; i++) {
            var a0 = trailPointAlpha(now, trail[i].t);
            var a1 = trailPointAlpha(now, trail[i + 1].t);
            var segA = Math.min(a0, a1);
            if (segA <= 0) continue;
            ctx.strokeStyle = 'rgba(255, 45, 45, ' + segA + ')';
            ctx.beginPath();
            ctx.moveTo(trail[i].x * w, trail[i].y * h);
            ctx.lineTo(trail[i + 1].x * w, trail[i + 1].y * h);
            ctx.stroke();
        }
        if (trail.length === 1) {
            var aDot = trailPointAlpha(now, trail[0].t);
            if (aDot > 0) {
                ctx.fillStyle = 'rgba(255, 45, 45, ' + aDot + ')';
                ctx.beginPath();
                ctx.arc(trail[0].x * w, trail[0].y * h, 2.5, 0, Math.PI * 2);
                ctx.fill();
            }
        }
        ctx.restore();

        var cx     = cat.x * w;
        var cy     = cat.y * h;
        var jumpPx = catJump * JUMP_MAX_PX;

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

        if (catImg.complete) {
            ctx.drawImage(catImg, cx - CAT_SIZE / 2, cy - CAT_SIZE / 2 - jumpPx, CAT_SIZE, CAT_SIZE);
        }

        requestAnimationFrame(draw);
    }
    requestAnimationFrame(draw);
}

window.addEventListener('load', function () {
    retryBtn.addEventListener('click', function () { location.reload(); });
    initSocket();
});

window.addEventListener('beforeunload', function () {
    if (socket && socket.connected) socket.emit('leave');
});
