function createTunnelGateway({ AmyraxTraffic }) {
  const crypto = require('crypto'), net = require('net');
  const { Transform } = require('stream');
  const { WebSocketServer, createWebSocketStream } = require('ws');
  const { performance } = require('perf_hooks');
  const tunnelPath = '/Telegram=@AmyraxVPN';
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    for (let i = 0; i < 8; i++) n = (n >>> 1) ^ ((n & 1) ? 0xedb88320 : 0);
    return n >>> 0;
  });
  function crc32(bytes) {
    let crc = 0xffffffff;
    for (const b of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ b) & 255];
    return (crc ^ 0xffffffff) >>> 0;
  }
  function vmessKey(uuid) {
    const commandKey = crypto.createHash('md5').update(Buffer.from(uuid.replaceAll('-', ''), 'hex'))
      .update('c48619fe-8f02-49e0-b9e9-edf763e17e21').digest();
    const inner = data => crypto.createHmac('sha256', 'VMess AEAD KDF').update(data).digest();
    const salt = Buffer.from('AES Auth ID Encryption');
    const ipad = Buffer.alloc(64, 0x36), opad = Buffer.alloc(64, 0x5c);
    for (let i = 0; i < salt.length; i++) { ipad[i] ^= salt[i]; opad[i] ^= salt[i]; }
    return inner(Buffer.concat([opad, inner(Buffer.concat([ipad, commandKey]))])).subarray(0, 16);
  }
  function ssKey(password) {
    let previous = Buffer.alloc(0), key = Buffer.alloc(0);
    while (key.length < 32) {
      previous = crypto.createHash('md5').update(previous).update(password).digest();
      key = Buffer.concat([key, previous]);
    }
    return key.subarray(0, 32);
  }
  class TunnelGateway {
    constructor(config, ports) {
      this.config = config; this.ports = ports; this.keys = new Map();
      this.wss = new WebSocketServer({ noServer: true, clientTracking: false, perMessageDeflate: false, maxPayload: 1024 * 1024 });
    }
    candidates() {
      const manager = this.config.userManager, list = [];
      const uuid = manager?.stateManager.state.uuid || this.config.uuid;
      if (uuid) list.push({ uuid, shared: true, password: manager?.stateManager.state.shadowsocksPassword || this.config.shadowsocks.password });
      if (manager && !manager.loadError && manager.running && !manager.stopped) {
        for (const u of manager.users) if (manager.permitted(u)) list.push({ uuid: u.uuid, id: u.id, password: u.uuid });
      }
      const current = new Set(list.map(c => c.uuid));
      for (const key of this.keys.keys()) if (!current.has(key)) this.keys.delete(key);
      for (const c of list) {
        if (!this.keys.has(c.uuid)) this.keys.set(c.uuid, {
          uuid: Buffer.from(c.uuid.replaceAll('-', ''), 'hex'), vmess: vmessKey(c.uuid),
          trojan: Buffer.from(crypto.createHash('sha224').update(c.uuid).digest('hex')),
          ss: ssKey(c.password || c.uuid)
        });
        c.keys = this.keys.get(c.uuid);
      }
      return list;
    }
    target(candidate, protocol) {
      if (candidate.shared) {
        const key = {vless:'vlessWs',vmess:'vmessWs',trojan:'trojanWs',shadowsocks:'shadowsocks'}[protocol];
        return this.ports[key] ? { ...candidate, protocol, port: this.ports[key] } : null;
      }
      const manager = this.config.userManager;
      const user = manager.users.find(u => u.id === candidate.id);
      const target = manager.targets.get(candidate.id)?.[protocol];
      return user && user.uuid === candidate.uuid && manager.permitted(user) && user.protocols.includes(protocol) && target
        ? { ...candidate, ...target, protocol } : null;
    }
    identify(bytes, candidates) {
      if (bytes.length >= 58 && bytes[56] === 13 && bytes[57] === 10) {
        const candidate = candidates.find(c => c.keys.trojan.equals(bytes.subarray(0, 56)));
        if (candidate) return this.target(candidate, 'trojan');
      }
      if (bytes.length >= 17 && bytes[0] === 0) {
        const candidate = candidates.find(c => c.keys.uuid.equals(bytes.subarray(1, 17)));
        if (candidate) return this.target(candidate, 'vless');
      }
      if (bytes.length >= 16) {
        for (const c of candidates) {
          const decipher = crypto.createDecipheriv('aes-128-ecb', c.keys.vmess, null); decipher.setAutoPadding(false);
          const auth = decipher.update(bytes.subarray(0, 16));
          const timestamp = Number(auth.readBigUInt64BE(0));
          if (Math.abs(timestamp - Date.now() / 1000) <= 120 && auth.readUInt32BE(12) === crc32(auth.subarray(0, 12))) {
            return this.target(c, 'vmess');
          }
        }
      }
      if (bytes.length >= 50) {
        for (const c of candidates) {
          if (!this.target(c, 'shadowsocks')) continue;
          try {
            const key = crypto.hkdfSync('sha1', c.keys.ss, bytes.subarray(0,32), 'ss-subkey', 32);
            const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.alloc(12));
            decipher.setAuthTag(bytes.subarray(34,50));
            const length = Buffer.concat([decipher.update(bytes.subarray(32,34)),decipher.final()]).readUInt16BE();
            if (length > 0 && length <= 0x3fff) return this.target(c, 'shadowsocks');
          } catch {}
        }
      }
      return null;
    }
    accept(stream, transport, tls = false, head = Buffer.alloc(0)) {
      stream.on('error', () => stream.destroy());
      const timer = setTimeout(() => stream.destroy(), 10000); timer.unref();
      stream.once('close', () => clearTimeout(timer));
      const candidates = this.candidates();
      let initial = Buffer.alloc(0);
      const sniff = chunk => {
        if (initial.length + chunk.length > 128 * 1024) { stream.destroy(); return; }
        initial = Buffer.concat([initial, chunk]);
        if (initial.length < 16) return;
        const target = this.identify(initial, candidates);
        if (!target) { if (initial.length >= 58) stream.destroy(); return; }
        stream.pause(); stream.removeListener('data', sniff); clearTimeout(timer);
        this.relay(stream, initial, target, tls, transport);
      };
      stream.on('data', sniff);
      if (head.length) sniff(head);
    }
    handleUpgrade(req, socket, head) {
      let pathname;
      try { pathname = decodeURIComponent(String(req.url || '').split('?')[0]); } catch { pathname = ''; }
      if (pathname !== tunnelPath || req.headers['sec-websocket-protocol']) {
        socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); return;
      }
      socket.setTimeout(0); socket.setNoDelay(true); socket.setKeepAlive(true, 10000);
      if (!req.headers['sec-websocket-key']) {
        if (req.method !== 'GET' || String(req.headers.upgrade).toLowerCase() !== 'websocket') { socket.destroy(); return; }
        socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: upgrade\r\nUpgrade: websocket\r\n\r\n');
        this.accept(socket, 'HTTPUpgrade', Boolean(req.socket.encrypted), head);
        return;
      }
      this.wss.handleUpgrade(req, socket, head, ws => {
        const stream = createWebSocketStream(ws);
        this.watchHeartbeat(ws);
        stream.on('error', () => stream.destroy());
        ws.on('message', (_, binary) => { if (!binary) stream.destroy(); });
        this.accept(stream, 'WS', Boolean(req.socket.encrypted));
      });
    }
    watchHeartbeat(ws) {
      let missed = 0, lastTick = performance.now();
      const active = () => { missed = 0; };
      ws.on('pong',active); ws.on('message',active);
      const timer = setInterval(() => {
        if (ws.readyState !== 1) return;
        const now = performance.now();
        if (now - lastTick > 45000) missed = 0;
        lastTick = now;
        if (missed >= 2) { ws.terminate(); return; }
        missed++; ws.ping();
      },30000);
      timer.unref();
      ws.once('close',() => { clearInterval(timer); ws.removeListener('pong',active); ws.removeListener('message',active); });
    }
    relay(stream, initial, target, tls, transport = 'WS') {
      const manager = this.config.userManager, transforms = [];
      const label = {vless:'VLESS',vmess:'VMess',trojan:'Trojan',shadowsocks:'Shadowsocks'}[target.protocol] + '-' + transport + (tls ? '-TLS' : '');
      let done = () => {};
      const backend = net.connect(target.port, '127.0.0.1');
      let closed = false;
      const connection = { generation: target.generation, close() {
        if (closed) return; closed = true;
        stream.destroy(); backend.destroy(); transforms.forEach(t => t.destroy()); done();
        if (!target.shared) { manager.connections.get(target.id)?.delete(connection); manager.retire(); }
      } };
      if (!target.shared) {
        if (!manager.connections.has(target.id)) manager.connections.set(target.id, new Set());
        manager.connections.get(target.id).add(connection);
      }
      const meter = direction => new Transform({ transform(chunk, _, callback) {
        const user = target.shared ? null : manager.users.find(u => u.id === target.id);
        const allowed = target.shared ? chunk.length
          : user?.uuid === target.uuid && user.protocols.includes(target.protocol) ? manager.charge(target.id, direction, chunk.length) : 0;
        if (!allowed) { callback(new Error('Connection no longer permitted')); connection.close(); return; }
        AmyraxTraffic.add(label, direction === 'up' ? allowed : 0, direction === 'down' ? allowed : 0);
        callback(null, chunk.subarray(0, allowed));
        if (allowed < chunk.length) setImmediate(() => connection.close());
      } });
      const up = meter('up'), down = meter('down'); transforms.push(up, down);
      for (const s of [stream, backend, up, down]) s.on('error', () => connection.close());
      stream.once('close', () => connection.close());
      backend.once('close', () => { if (!backend.readableEnded) connection.close(); });
      backend.setTimeout(10000, () => connection.close());
      backend.once('connect', () => {
        if (closed) return;
        backend.setTimeout(0); backend.setNoDelay(true); backend.setKeepAlive(true, 10000);
        if (!this.target(target, target.protocol)) { connection.close(); return; }
        done = AmyraxTraffic.open(label,target.shared ? 'shared' : target.id);
        up.pipe(backend); backend.pipe(down).pipe(stream);
        up.write(initial); stream.pipe(up); stream.resume();
      });
    }
  }
  TunnelGateway.path = tunnelPath;
  return TunnelGateway;
}
module.exports = createTunnelGateway;
