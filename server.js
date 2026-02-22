const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const QRCode = require('qrcode');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Serve static files from the 'public' folder
app.use(express.static('public'));

// Quick endpoint to generate QR code on the fly
app.get('/qr', async (req, res) => {
    try {
        const url = req.query.url;
        if (!url) return res.status(400).send('URL required');
        const qrDataUrl = await QRCode.toDataURL(url);
        res.send(`<img src="${qrDataUrl}" alt="QR Code" />`);
    } catch (error) {
        res.status(500).send('Error generating QR code');
    }
});

let peers = {
    host: null,
    client: null
};

wss.on('connection', (ws) => {
    let role = null;

    // Assign roles based on who is missing. First is host, second is client.
    if (!peers.host) {
        role = 'host';
        peers.host = ws;
        console.log('Host connected');
    } else if (!peers.client) {
        role = 'client';
        peers.client = ws;
        console.log('Client connected');
    } else {
        // Already full room
        ws.send(JSON.stringify({ type: 'error', message: 'Room is full' }));
        ws.close();
        return;
    }

    // Send the role to the connected peer
    ws.send(JSON.stringify({ type: 'role', role: role }));

    // Notify the host if the client just connected
    if (role === 'client' && peers.host) {
        peers.host.send(JSON.stringify({ type: 'client_connected' }));
    }

    // Handle incoming signaling messages
    ws.on('message', (message) => {
        let data;
        try {
            data = JSON.parse(message);
        } catch (e) {
            return console.error('Invalid message format', message);
        }

        console.log(`Received message of type ${data.type} from ${role}`);

        // Relay messages to the other peer
        const target = (role === 'host') ? peers.client : peers.host;
        if (target && target.readyState === WebSocket.OPEN) {
            target.send(JSON.stringify(data));
        }
    });

    // Clean up on disconnect
    ws.on('close', () => {
        console.log(`${role} disconnected`);
        if (role === 'host') {
            peers.host = null;
        } else if (role === 'client') {
            peers.client = null;
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    // Listen on all interfaces so phone can connect via local IP
    console.log(`\nServer started on port ${PORT}`);
    console.log(`1. Local access: http://localhost:${PORT}`);
    console.log(`2. Find your local network IP (e.g., 192.168.x.x) and open that on your computer so the phone can reach it.`);
});
