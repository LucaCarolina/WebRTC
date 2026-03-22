require('dotenv').config();
const express = require('express');
const os      = require('os');
const fs      = require('fs');
const QRCode  = require('qrcode');
const { Server } = require('socket.io');

const app = express();

// TLS
const isDevelopment = !process.env.NODE_ENV || process.env.NODE_ENV === 'development';
const tlsOptions    = isDevelopment && fs.existsSync('./localhost.key') && fs.existsSync('./localhost.crt')
    ? { key: fs.readFileSync('./localhost.key'), cert: fs.readFileSync('./localhost.crt') }
    : {};

const secure = Object.keys(tlsOptions).length > 0;
const server = require(secure ? 'https' : 'http').createServer(tlsOptions, app);
const io     = new Server(server);

// static + helpers
app.use(express.static('public'));

function getLanIPs() {
    const ips = [];
    for (const ifaces of Object.values(os.networkInterfaces())) {
        for (const iface of ifaces) {
            if (iface.family === 'IPv4' && !iface.internal) ips.push(iface.address);
        }
    }
    return ips.length > 0 ? ips : ['localhost'];
}

app.get('/qr', async (req, res) => {
    if (!req.query.url) return res.status(400).send('URL required');
    try {
        const dataUrl = await QRCode.toDataURL(req.query.url, { margin: 1, width: 256 });
        res.send(`<img src="${dataUrl}" alt="QR Code" />`);
    } catch {
        res.status(500).send('Error generating QR code');
    }
});

app.get('/ip', (_req, res) => res.json({ ips: getLanIPs() }));

// pairing state
/** socketId -> true  (all connected sockets) */
const connected = new Set();
/** hostSocketId -> clientSocketId */
const hostToClient = new Map();
/** clientSocketId -> hostSocketId */
const clientToHost = new Map();

function notifyPeerLeft(id) {
    if (clientToHost.has(id)) {
        const hostId = clientToHost.get(id);
        clientToHost.delete(id);
        if (hostToClient.get(hostId) === id) hostToClient.delete(hostId);
        io.to(hostId).emit('peer_left');
    } else if (hostToClient.has(id)) {
        const clientId = hostToClient.get(id);
        hostToClient.delete(id);
        if (clientId) {
            clientToHost.delete(clientId);
            io.to(clientId).emit('peer_left');
        }
    }
}

// socket.io
io.on('connection', (socket) => {
    connected.add(socket.id);

    socket.on('pairWith', (hostId) => {
        const hid = String(hostId || '').trim();
        if (!hid || !connected.has(hid)) {
            socket.emit('pair_error', { message: 'Host not found. Scan the QR again.' });
            return;
        }
        if (hid === socket.id) {
            socket.emit('pair_error', { message: 'Invalid pairing.' });
            return;
        }

        // Evict any previous client from this host
        const prev = hostToClient.get(hid);
        if (prev && prev !== socket.id) {
            clientToHost.delete(prev);
            io.to(prev).emit('peer_left');
        }

        hostToClient.set(hid, socket.id);
        clientToHost.set(socket.id, hid);
        io.to(hid).emit('peer_ready', { clientId: socket.id });
    });

    socket.on('signal', (peerId, signal) => {
        const pid = String(peerId || '');
        if (!pid || !connected.has(pid)) return;
        const ok = hostToClient.get(socket.id) === pid || clientToHost.get(socket.id) === pid;
        if (ok) io.to(pid).emit('signal', signal, socket.id);
    });

    socket.on('leave', () => {
        notifyPeerLeft(socket.id);
        connected.delete(socket.id);
    });

    socket.on('disconnect', () => {
        console.log(`disconnect ${socket.id}`);
        notifyPeerLeft(socket.id);
        connected.delete(socket.id);
    });
});

// start
const PORT  = process.env.PORT || 3000;
const proto = secure ? 'https' : 'http';

server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🐱 Cat Laser Pointer Remote`);
    console.log(`   Local:   ${proto}://localhost:${PORT}`);
    getLanIPs().forEach((ip) => console.log(`   Network: ${proto}://${ip}:${PORT}`));
    console.log('');
}); 