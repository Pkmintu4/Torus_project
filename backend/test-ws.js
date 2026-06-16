const WebSocket = require('ws');

const url = 'ws://127.0.0.1:5000/ws';
const ws = new WebSocket(url);

ws.on('open', () => {
  console.log('CONNECTED to', url);
  ws.send(JSON.stringify({ type: 'join', roomId: 'TESTROOM', role: 'doctor' }));
});

ws.on('message', (msg) => {
  console.log('RECV:', msg.toString());
});

ws.on('error', (err) => {
  console.error('WS ERROR:', err && err.message);
  process.exit(2);
});

ws.on('close', (code, reason) => {
  console.log('CLOSED', code, reason && reason.toString());
  process.exit(0);
});

setTimeout(() => {
  console.log('Timeout reached, closing');
  ws.close();
}, 5000);
