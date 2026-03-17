const express = require('express');
const http = require('http');
const os = require('os');
const WebSocket = require('ws');
const QRCode = require('qrcode');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Serve static files from the 'public' folder
app.use(express.static('public'));

// Return a QR code image for any URL
app.get('/qr', async (req, res) => {
    try {
        const url = req.query.url;
        if (!url) return res.status(400).send('URL required');
        const qrDataUrl = await QRCode.toDataURL(url, { margin: 1, width: 256 });
        res.send(`<img src="${qrDataUrl}" alt="QR Code" />`);
    } catch (error) {
        res.status(500).send('Error generating QR code');
    }
});

// Return the server's usable URLs so the host page can build a scannable QR URL
app.get('/ip', (req, res) => {
    res.json({ ips: getLanIPs() });
});

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

// ─── Signaling ───

const rooms = new Map();
const RELAY_MESSAGE_TYPES = new Set(['offer', 'answer', 'candidate']);

function send(ws, payload) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(payload));
    }
}

function getRoom(roomId) {
    if (!rooms.has(roomId)) {
        rooms.set(roomId, { host: null, client: null });
    }
    return rooms.get(roomId);
}

function getOtherRole(role) {
    return role === 'host' ? 'client' : 'host';
}

function chooseRole(room, requestedRole) {
    if (requestedRole === 'host' || requestedRole === 'client') {
        return room[requestedRole] ? null : requestedRole;
    }
    if (!room.host) return 'host';
    if (!room.client) return 'client';
    return null;
}

function cleanupPeer(ws) {
    if (!ws.roomId || !ws.role) return;

    const room = rooms.get(ws.roomId);
    if (!room) return;

    if (room[ws.role] === ws) {
        room[ws.role] = null;
    }

    const otherPeer = room[getOtherRole(ws.role)];
    send(otherPeer, { type: 'peer_left', role: ws.role, room: ws.roomId });

    if (!room.host && !room.client) {
        rooms.delete(ws.roomId);
    }

    ws.roomId = null;
    ws.role = null;
}//Peer disconnect cleanup so the room stays usable
//When the phone disconnects, the host receives a peer_left message and shows the QR code again. 
// A new device can re-join the same room without the host needing to reload or create a new session.



function joinRoom(ws, data) {
    const roomId = String(data.room || '').trim();
    const requestedRole = data.requestedRole;

    if (!/^[a-zA-Z0-9_-]{4,32}$/.test(roomId)) {
        send(ws, { type: 'error', message: 'Invalid room id.' });
        return;
    }

    cleanupPeer(ws);

    const room = getRoom(roomId);
    const role = chooseRole(room, requestedRole);

    if (!role) {
        send(ws, { type: 'error', message: 'That room slot is already in use.' });
        return;
    }

    ws.roomId = roomId;
    ws.role = role;
    room[role] = ws;

    console.log(`${role} joined room ${roomId}`);

    const otherPeer = room[getOtherRole(role)];
    send(ws, {
        type: 'joined',
        room: roomId,
        role,
        peerPresent: Boolean(otherPeer),
    });

    if (otherPeer) {
        send(ws, { type: 'peer_ready', room: roomId, peerRole: otherPeer.role });
        send(otherPeer, { type: 'peer_ready', room: roomId, peerRole: role });
    }
}

function relayToPeer(ws, message) {
    if (!ws.roomId || !ws.role) {
        send(ws, { type: 'error', message: 'Join a room before signaling.' });
        return;
    }

    const room = rooms.get(ws.roomId);
    if (!room) {
        send(ws, { type: 'error', message: 'Room no longer exists.' });
        return;
    }

    const target = room[getOtherRole(ws.role)];
    if (!target) {
        send(ws, { type: 'error', message: 'The other peer is not connected yet.' });
        return;
    }

    send(target, message);
}

wss.on('connection', (ws) => {
    ws.roomId = null;
    ws.role = null;

    ws.on('message', (message) => {
        let data;
        try {
            data = JSON.parse(message);
        } catch (error) {
            send(ws, { type: 'error', message: 'Invalid message format.' });
            return;
        }

        if (data.type === 'join') {
            joinRoom(ws, data);
            return;
        }

        if (data.type === 'leave') {
            cleanupPeer(ws);
            return;
        }

        if (RELAY_MESSAGE_TYPES.has(data.type)) {
            relayToPeer(ws, data);
            return;
        }

        send(ws, { type: 'error', message: `Unsupported message type: ${data.type}` });
    });

    ws.on('close', () => {
        if (ws.role) {
            console.log(`${ws.role} disconnected from room ${ws.roomId}`);
        }
        cleanupPeer(ws);
    });
});

// ─── Start ───

const PORT = process.env.PORT || 3000;

server.listen(PORT, '0.0.0.0', () => {
    const ips = getLanIPs();
    console.log(`\n🐱 Cat Laser Pointer Remote`);
    console.log(`   Local:   http://localhost:${PORT}`);
    ips.forEach(ip => {
        console.log(`   Network: http://${ip}:${PORT}`);
    });
    console.log('');
});
