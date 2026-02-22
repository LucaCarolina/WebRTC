const statusDiv = document.getElementById('status');
const qrDiv = document.getElementById('qr');
const sendBtn = document.getElementById('send-btn');
const messagesDiv = document.getElementById('messages');

let ws;
let peerConnection;
let dataChannel;
let myRole = null; // 'host' or 'client'

// Config for STUN servers
const rtcConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' }
    ]
};

// Update status UI
function updateStatus(msg) {
    statusDiv.textContent = msg;
    console.log('[Status]', msg);
}

// 1. Connect to WebSocket signaling server
function connectSignaling() {
    // Infer WS URL from current page URL
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${window.location.host}`;
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        updateStatus('Signaling connected.');
    };

    ws.onmessage = async (event) => {
        const data = JSON.parse(event.data);
        console.log('WS Message received:', data.type);

        switch (data.type) {
            case 'role':
                myRole = data.role;
                handleRoleAssigned();
                break;

            case 'client_connected':
                // Host gets this when the client scans QR and connects
                updateStatus('Client connected! Starting WebRTC handshake...');
                qrDiv.style.display = 'none'; // hide QR code
                startWebRTCHandshake();
                break;

            case 'error':
                updateStatus('Error: ' + data.message);
                break;

            // WebRTC Signaling Handshake
            case 'offer':
                await handleOffer(data.offer);
                break;

            case 'answer':
                await handleAnswer(data.answer);
                break;

            case 'candidate':
                await handleCandidate(data.candidate);
                break;
        }
    };

    ws.onclose = () => {
        updateStatus('Signaling disconnected.');
    };
}

// 2. Handle Role mapping
function handleRoleAssigned() {
    updateStatus(`Assigned role: ${myRole}`);

    if (myRole === 'host') {
        // Suggest using local IP if opened on localhost
        if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
            qrDiv.innerHTML = '<p style="color:red">Warning: You are using localhost. Phones cannot scan this and connect to localhost. Please open this app using your local network IP (e.g. 192.168.x.x).</p>';
        } else {
            // Generate QR showing the current URL
            const currentUrl = window.location.href;
            // We call the server endpoint that returns the HTML <img> tag with the QR
            fetch('/qr?url=' + encodeURIComponent(currentUrl))
                .then(res => res.text())
                .then(html => {
                    qrDiv.innerHTML = `<p>Scan with your phone to connect as client:</p>` + html;
                });
        }
        // We wait for the client to connect before making the offer
    } else if (myRole === 'client') {
        // Client hides QR
        qrDiv.style.display = 'none';
        updateStatus('Connected as client. Waiting for Host to offer...');
    }
}

// 3. WebRTC Setup - Creates PeerConnection and handles ICE candidates
function createPeerConnection() {
    peerConnection = new RTCPeerConnection(rtcConfig);

    // On ICE candidate generation, send it to the other peer via WS
    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            console.log('Sending ICE candidate');
            ws.send(JSON.stringify({ type: 'candidate', candidate: event.candidate }));
        }
    };

    // Connection state changes
    peerConnection.onconnectionstatechange = () => {
        updateStatus(`WebRTC State: ${peerConnection.connectionState}`);
    };

    // Listen for data channel from the other side (Client receives this)
    peerConnection.ondatachannel = (event) => {
        console.log('Data channel received via event');
        dataChannel = event.channel;
        setupDataChannelEvents();
    };
}

// 4. Host side: start handshake after client connects
async function startWebRTCHandshake() {
    createPeerConnection();

    // Create Data Channel (Host has to create it first)
    dataChannel = peerConnection.createDataChannel('control');
    setupDataChannelEvents();

    // Create Offer
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    // Send Offer via WS
    console.log('Sending Offer');
    ws.send(JSON.stringify({ type: 'offer', offer }));
}

// 5. Client side: receive offer, send answer
async function handleOffer(offer) {
    createPeerConnection();

    await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));

    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);

    console.log('Sending Answer');
    ws.send(JSON.stringify({ type: 'answer', answer }));
}

// 6. Host side: receive answer from client
async function handleAnswer(answer) {
    await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
}

// 7. Both: add incoming ICE candidates
async function handleCandidate(candidate) {
    try {
        await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (e) {
        console.error('Error adding ICE candidate', e);
    }
}

// 8. Attach DataChannel events
function setupDataChannelEvents() {
    dataChannel.onopen = () => {
        updateStatus('Connected! WebRTC Data Channel is open.');
        sendBtn.disabled = false;
        // Send an automatic test message
        dataChannel.send(`Hello from ${myRole}!`);
    };

    dataChannel.onclose = () => {
        updateStatus('WebRTC Data Channel closed.');
        sendBtn.disabled = true;
    };

    dataChannel.onmessage = (event) => {
        console.log('Message via DataChannel:', event.data);
        const msgEl = document.createElement('p');
        msgEl.innerHTML = `<strong>[Remote]:</strong> ${event.data}`;
        messagesDiv.appendChild(msgEl);
    };
}

// Add Button Event
sendBtn.addEventListener('click', () => {
    if (dataChannel && dataChannel.readyState === 'open') {
        const msg = `Test message at ${new Date().toLocaleTimeString()}`;
        dataChannel.send(msg);
        // Add to own UI
        const msgEl = document.createElement('p');
        msgEl.innerHTML = `<strong style="color: blue;">[Me]:</strong> ${msg}`;
        messagesDiv.appendChild(msgEl);
    }
});

// Start the process on load
window.addEventListener('load', connectSignaling);
