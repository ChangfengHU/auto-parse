#!/usr/bin/env node

const net = require('net');
const tls = require('tls');

const input = process.argv[2] || '';
const hostname = input
  .replace(/^https?:\/\//, '')
  .replace(/\/.*$/, '')
  .trim();

if (!hostname) {
  console.error('Usage: node scripts/verify-cloudflare-vnc.js <hostname-or-url>');
  process.exit(2);
}

function requestHead(pathname) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect(443, hostname, { servername: hostname });
    let data = '';
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`HEAD ${pathname} timeout`));
    }, 10000);

    socket.on('connect', () => {
      socket.write(`HEAD ${pathname} HTTP/1.1\r\nHost: ${hostname}\r\nConnection: close\r\n\r\n`);
    });
    socket.on('data', (chunk) => {
      data += chunk.toString('utf8');
    });
    socket.on('end', () => {
      clearTimeout(timer);
      resolve(data.split('\n')[0].trim());
    });
    socket.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function websocketUpgrade(pathname) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect(443, hostname, { servername: hostname });
    let data = '';
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`WebSocket ${pathname} timeout; received=${JSON.stringify(data.slice(0, 160))}`));
    }, 10000);

    socket.on('connect', () => {
      socket.write(
        `GET ${pathname} HTTP/1.1\r\n` +
          `Host: ${hostname}\r\n` +
          'Upgrade: websocket\r\n' +
          'Connection: Upgrade\r\n' +
          'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n' +
          'Sec-WebSocket-Version: 13\r\n' +
          'Sec-WebSocket-Protocol: binary\r\n' +
          '\r\n'
      );
    });
    socket.on('data', (chunk) => {
      data += chunk.toString('binary');
      if (data.includes('HTTP/1.1 101')) {
        clearTimeout(timer);
        socket.destroy();
        resolve(data.split('\n')[0].trim());
      }
    });
    socket.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

(async () => {
  const vncPath = '/vnc.html?path=websockify&autoconnect=1&reconnect=1&resize=remote';
  const html = await requestHead(vncPath);
  const ws = await websocketUpgrade('/websockify');

  console.log(`hostname=${hostname}`);
  console.log(`html=${html}`);
  console.log(`websocket=${ws}`);

  if (!/\s200\s/.test(html) || !/\s101\s/.test(ws)) {
    process.exit(1);
  }
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
