function createConfigStudio({ LinkGenerator, TransportSupport, Logger }) {
  const fs = require('fs'), path = require('path'), crypto = require('crypto'), net = require('net');
  const { spawn, execFile } = require('child_process');
  const clone = value => JSON.parse(JSON.stringify(value));
  const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
  const fingerprints = ['', 'chrome', 'firefox', 'safari', 'edge', 'ios', 'android', 'random', 'randomized', '360', 'qq'];
  const defaultPath = '/Telegram=@AmyraxVPN';
  function host(value) {
    if (typeof value !== 'string') fail('آدرس سرور معتبر نیست.');
    value = value.trim().replace(/^\[|\]$/g, '').toLowerCase();
    if (!value || value.length > 253 || (!net.isIP(value) && !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(value))) fail('دامنه یا IP را بدون https و مسیر وارد کنید.');
    return value;
  }
  function port(value) { if (!Number.isInteger(value) || value < 1 || value > 65535) fail('پورت باید بین ۱ و ۶۵۵۳۵ باشد.'); return value; }
  function label(value) {
    if (typeof value !== 'string' || !value.trim() || value.length > 80 || /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(value)) fail('نام کانفیگ معتبر نیست (حداکثر ۸۰ نویسه).');
    return value.trim();
  }
  function stream(protocol, transport, security, values) {
    if (!['tcp', 'ws', 'grpc', 'httpupgrade', 'xhttp'].includes(transport)) fail('این نوع انتقال پشتیبانی نمی‌شود.');
    if (!['none', 'tls', 'reality'].includes(security)) fail('این نوع امنیت پشتیبانی نمی‌شود.');
    const s = { network: transport, security };
    if (security === 'tls') s.tlsSettings = { serverName: values.sni || values.host, allowInsecure: values.insecure === '1', ...(values.fp ? { fingerprint: values.fp } : {}), ...(values.alpn ? { alpn: values.alpn.split(',') } : {}) };
    if (security === 'reality') {
      if (!values.pbk || !values.sni) fail('برای Reality کلید عمومی و SNI لازم است.');
      s.realitySettings = { serverName: values.sni, fingerprint: values.fp || 'chrome', publicKey: values.pbk, shortId: values.sid || '', spiderX: values.spx || '/' };
    }
    if (transport === 'ws') s.wsSettings = { path: values.path || '/', headers: { Host: values.host || values.sni || '' } };
    if (transport === 'httpupgrade') s.httpupgradeSettings = { path: values.path || '/', host: values.host || values.sni || '' };
    if (transport === 'grpc') s.grpcSettings = { serviceName: values.serviceName || '', multiMode: values.mode === 'multi' };
    if (transport === 'xhttp') s.xhttpSettings = { path: values.path || '/', host: values.host || values.sni || '', mode: values.mode || 'auto' };
    return s;
  }
  function fromUri(input, tag = 'amyrax-upstream') {
    let ob;
    if (input.startsWith('vmess://')) {
      let v; try { v = JSON.parse(Buffer.from(input.slice(8), 'base64').toString('utf8')); } catch { fail('لینک VMess معتبر نیست.'); }
      ob = { protocol: 'vmess', settings: { vnext: [{ address: host(v.add), port: port(Number(v.port)), users: [{ id: v.id, alterId: Number(v.aid || 0), security: v.scy || 'auto' }] }] }, streamSettings: stream('vmess', v.net || 'tcp', v.tls === 'tls' ? 'tls' : 'none', { ...v, serviceName: v.path, insecure: String(v.insecure || '0') }) };
    } else {
      let u; try { u = new URL(input); } catch { fail('لینک اتصال معتبر نیست.'); }
      const protocol = u.protocol.slice(0, -1), address = host(u.hostname), endpointPort = port(Number(u.port));
      const values = Object.fromEntries(u.searchParams); values.host ||= address;
      const credential = decodeURIComponent(u.username);
      if (protocol === 'ss') {
        let credentials = credential.includes(':') ? credential : Buffer.from(credential, 'base64').toString('utf8');
        const split = credentials.indexOf(':'); if (split < 1) fail('کلید Shadowsocks معتبر نیست.');
        ob = { protocol: 'shadowsocks', settings: { servers: [{ address, port: endpointPort, method: credentials.slice(0, split), password: credentials.slice(split + 1) }] } };
        if (values.plugin) {
          if (!values.plugin.startsWith('v2ray-plugin;')) fail('این افزونهٔ Shadowsocks پشتیبانی نمی‌شود.');
          const opts = Object.fromEntries(values.plugin.split(';').slice(1).map(p => { const i = p.indexOf('='); return i < 0 ? [p, '1'] : [p.slice(0, i), p.slice(i + 1)]; }));
          ob.streamSettings = stream('shadowsocks', 'ws', opts.tls ? 'tls' : 'none', { host: opts.host || address, path: opts.path || '/', sni: opts.host || address });
        }
      } else if (['vless', 'trojan'].includes(protocol)) {
        ob = { protocol, settings: protocol === 'vless' ? { vnext: [{ address, port: endpointPort, users: [{ id: credential, encryption: values.encryption || 'none', ...(values.flow ? { flow: values.flow } : {}) }] }] } : { servers: [{ address, port: endpointPort, password: credential }] }, streamSettings: stream(protocol, values.type || 'tcp', values.security || (protocol === 'trojan' ? 'tls' : 'none'), { ...values, insecure: values.insecure || values.allowInsecure }) };
      } else fail('لینک VLESS، VMess، Trojan یا Shadowsocks لازم است.');
    }
    ob.tag = tag; return ob;
  }
  function outbound(input) {
    if (typeof input !== 'string' || !input.trim() || input.length > 16000) fail('لینک یا Outbound JSON را وارد کنید.');
    input = input.trim();
    if (!input.startsWith('{')) return fromUri(input);
    let value; try { value = JSON.parse(input); } catch { fail('JSON معتبر نیست.'); }
    if (value.outbounds) { if (!Array.isArray(value.outbounds) || value.outbounds.length !== 1) fail('فقط یک Outbound در JSON وارد کنید.'); value = value.outbounds[0]; }
    if (!['vless', 'vmess', 'trojan', 'shadowsocks', 'socks', 'http'].includes(value.protocol) || !value.settings || Object.keys(value).some(k => !['protocol', 'tag', 'settings', 'streamSettings', 'mux'].includes(k))) fail('یک Outbound استاندارد Xray لازم است؛ اتصال زنجیره‌ای وابسته به detour پذیرفته نمی‌شود.');
    value = clone(value); value.tag = 'amyrax-upstream'; return value;
  }
  function singboxRoute(config) {
    const egress = config.configStudio?.egress;
    if (!egress?.enabled) return { outbounds: [{ type: 'direct', tag: 'direct' }], route: { final: 'direct' } };
    if (!config.configStudio.egressPort) return { outbounds: [{ type: 'block', tag: 'egress-unavailable' }], route: { final: 'egress-unavailable' } };
    return { outbounds: [{ type: 'socks', tag: 'amyrax-upstream', server: '127.0.0.1', server_port: config.configStudio.egressPort, version: '5' }], route: { final: 'amyrax-upstream' } };
  }
  class Studio {
    constructor(config, stateManager) {
      this.config = config; this.stateManager = stateManager; this.file = path.join(config.paths.dataDir, 'custom-configs.json');
      this.profiles = []; this.revision = 0; this.egress = { enabled: false }; this.pendingEgress = this.egress;
      try {
        if (fs.existsSync(this.file)) {
          const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
          if (saved.version !== 1 || !Array.isArray(saved.profiles) || !Number.isSafeInteger(saved.revision) || saved.revision < 0) throw new Error();
          const ids = new Set();
          for (const p of saved.profiles) {
            if (!/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/.test(p.id) || ids.has(p.id) || !Number.isSafeInteger(p.revision) || p.revision < 1) throw new Error();
            this.validate(p); ids.add(p.id);
          }
          if (typeof saved.egress?.enabled !== 'boolean') throw new Error();
          if (saved.egress.enabled) { label(saved.egress.name); outbound(saved.egress.input); }
          this.profiles = saved.profiles; this.revision = saved.revision; this.egress = saved.egress; this.pendingEgress = clone(saved.egress);
        }
      } catch { this.loadError = 'فایل کانفیگ‌های سفارشی معتبر نیست؛ custom-configs.json را بررسی کنید.'; this.egress = { enabled: true }; Logger.error(this.loadError); }
    }
    available() { if (this.loadError) fail(this.loadError, 503); }
    persist(profiles, egress = this.pendingEgress) {
      this.available();
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = this.file + '.tmp';
      const fd = fs.openSync(tmp, 'w', 0o600);
      try { fs.writeFileSync(fd, JSON.stringify({ version: 1, revision: this.revision + 1, profiles, egress })); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      fs.renameSync(tmp, this.file); this.revision++; this.profiles = profiles; this.pendingEgress = egress;
    }
    generator(accountId, resolvedHost, active = true) {
      if (accountId === 'shared') return new LinkGenerator(this.config, this.stateManager.state, resolvedHost);
      const manager = this.config.userManager, u = manager?.find(accountId);
      if (!u || u.archivedAt) fail('حساب انتخاب‌شده موجود نیست.', 404);
      if (active && !manager.permitted(u)) fail('این حساب اکنون اجازهٔ اتصال ندارد.', 403);
      return manager.generator(u, resolvedHost);
    }
    validate(p) {
      if (!p || typeof p !== 'object' || Array.isArray(p)) fail('اطلاعات کانفیگ معتبر نیست.');
      if (typeof p.accountId !== 'string' || (p.accountId !== 'shared' && !/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/.test(p.accountId))) fail('حساب معتبر نیست.');
      label(p.name); if (typeof p.variant !== 'string' || !/^(VLESS|VMess|Trojan|Shadowsocks)-(WS|HTTPUpgrade|gRPC|XHTTP)(-Stream)?(-TLS)?$/.test(p.variant)) fail('نوع کانفیگ معتبر نیست.');
      for (const k of ['server', 'sni', 'host']) { if (typeof p[k] !== 'string') fail('آدرس معتبر نیست.'); if (p[k]) host(p[k]); }
      if (p.port !== null) port(p.port);
      if (!fingerprints.includes(p.fingerprint)) fail('اثر انگشت TLS معتبر نیست.');
      if (typeof p.enabled !== 'boolean' || typeof p.path !== 'string') fail('تنظیم کانفیگ معتبر نیست.');
      if (p.path && (!/^\/[A-Za-z0-9/_.=@-]{1,180}$/.test(p.path) || p.path.includes('..') || ['/sub', '/assets', '/.well-known', '/amyrax-assets', '/' + this.config.panelPath.replace(/^\//, ''), '/health', '/healthz'].some(v => p.path === v || p.path.startsWith(v + '/')))) fail('مسیر اتصال باید با / شروع شود و با مسیرهای پنل تداخل نداشته باشد.');
      return p;
    }
    build(p, g) {
      this.validate(p);
      if (['PROXY', 'DIRECT', 'REJECT', 'direct', 'block', 'dns-out', '🛡️ Amyrax Panel', '⚡ Auto Select', '🟢 Direct', '🚫 Block'].includes(p.name)) fail('این نام برای گروه‌های خروجی رزرو شده است؛ نام دیگری انتخاب کنید.');
      const original = TransportSupport.nodes(g).find(n => n.type === p.variant);
      if (!original) fail('این پروتکل یا انتقال روی سرور یا حساب انتخاب‌شده فعال نیست.');
      if (p.path && !['ws', 'httpupgrade'].includes(original.transport) && p.path !== defaultPath) fail('مسیر دلخواه فعلاً برای WS و HTTPUpgrade قابل ساخت است؛ gRPC و XHTTP از مسیر فعال سرور استفاده می‌کنند.');
      if (p.variant.startsWith('Shadowsocks') && p.server && p.server !== g.host && !p.host) fail('برای Shadowsocks با آدرس جایگزین، Host سرور را هم وارد کنید.');
      const copy = Object.assign(Object.create(Object.getPrototypeOf(g)), g);
      copy.host = p.server || g.host; copy.port = p.port || g.port;
      copy.tlsOpt = { ...g.tlsOpt, sni: p.sni || g.tlsOpt.sni, wsHost: p.host || g.tlsOpt.wsHost, fp: p.fingerprint };
      copy.wsPath = p.path || defaultPath;
      copy.customWsHost = p.host || (original.tls ? g.tlsOpt.wsHost : g.host);
      const n = TransportSupport.nodes(copy).find(n => n.type === p.variant); n.name = p.name; n.customId = p.id || null;
      if (n.uri.startsWith('vmess://')) { const v = JSON.parse(Buffer.from(n.uri.slice(8), 'base64').toString()); v.ps = p.name; n.uri = 'vmess://' + Buffer.from(JSON.stringify(v)).toString('base64'); }
      else n.uri = n.uri.split('#')[0] + '#' + encodeURIComponent(p.name);
      if (n.clash) n.clash.name = p.name;
      for (const ob of n.singboxOutbound || []) ob.tag = p.name;
      if (n.singboxOutbound) n.singboxJson = JSON.stringify(n.singboxOutbound, null, 2);
      n.xrayJson = JSON.stringify(fromUri(n.uri, p.name), null, 2); return n;
    }
    nodes(g) {
      if (this.loadError) return [];
      const id = g.config.profileAccountId || 'shared';
      return this.profiles.filter(p => p.accountId === id && p.enabled).flatMap(p => { try { return [this.build(p, g)]; } catch { return []; } });
    }
    options(g) { return TransportSupport.nodes(g).map(n => ({ value: n.type, protocol: n.protocol, transport: n.transport, tls: n.tls })); }
    fields(input, accountId) {
      const keys = ['accountId', 'name', 'variant', 'server', 'port', 'sni', 'host', 'path', 'fingerprint', 'enabled', 'revision'];
      if (!input || Object.keys(input).some(k => !keys.includes(k))) fail('تنظیم ناشناخته در کانفیگ.');
      if (accountId && input.accountId !== accountId) fail('فقط کانفیگ حساب خودتان قابل تغییر است.', 403);
      return this.validate({ accountId: input.accountId, name: input.name, variant: input.variant, server: input.server || '', port: input.port ?? null, sni: input.sni || '', host: input.host || '', path: input.path || '', fingerprint: input.fingerprint ?? 'chrome', enabled: input.enabled ?? true });
    }
    save(input, resolvedHost, scope, id) {
      this.available(); const old = id && this.profiles.find(p => p.id === id);
      if (id && (!old || (scope && old.accountId !== scope))) fail('کانفیگ پیدا نشد.', 404);
      if (old && old.revision !== input.revision) fail('کانفیگ تغییر کرده؛ فهرست را تازه کنید.', 409);
      const p = this.fields(input, scope); this.build(p, this.generator(p.accountId, resolvedHost, false));
      if (this.generator(p.accountId,resolvedHost,false).getAllNodes({compat:'full'}).some(n=>!n.customId&&n.name===p.name)) fail('نام با کانفیگ خودکار تکراری است؛ نام دیگری انتخاب کنید.',409);
      p.id = id || crypto.randomUUID(); p.revision = (old?.revision || 0) + 1;
      if (this.profiles.some(x => x.id !== id && x.accountId === p.accountId && x.name === p.name)) fail('نام کانفیگ در این حساب تکراری است.', 409);
      this.persist(id ? this.profiles.map(x => x.id === id ? p : x) : [...this.profiles, p]); return p;
    }
    remove(id, revision, scope) {
      this.available(); const old = this.profiles.find(p => p.id === id);
      if (!old || (scope && old.accountId !== scope)) fail('کانفیگ پیدا نشد.', 404);
      if (old.revision !== revision) fail('کانفیگ تغییر کرده؛ فهرست را تازه کنید.', 409);
      this.persist(this.profiles.filter(p => p.id !== id));
    }
    pathAccounts(p) {
      if (p === defaultPath) return undefined;
      return new Set(this.profiles.filter(c => c.enabled && (c.path || defaultPath) === p && /-(WS|HTTPUpgrade)/.test(c.variant)).map(c => c.accountId));
    }
    egressConfig(ob, listenPort) { return { log: { loglevel: 'warning' }, inbounds: [{ listen: '127.0.0.1', port: listenPort, protocol: 'socks', settings: { auth: 'noauth', udp: true } }], outbounds: [ob] }; }
    async checkEgress(input, name, enabled, binary) {
      if (typeof enabled !== 'boolean') fail('وضعیت Outbound معتبر نیست.');
      if (!enabled) return { enabled: false };
      name = label(name); const ob = outbound(input);
      const targets = ob.settings.vnext || ob.settings.servers;
      if (!Array.isArray(targets) || targets.length !== 1) fail('یک سرور خروجی مستقل لازم است.');
      const destination = host(targets[0].address), destinationPort = port(targets[0].port);
      if (['localhost', '0.0.0.0', '::', '::1'].includes(destination) || /^127\./.test(destination) || ([this.config.domain, this.stateManager.state.publicHost].includes(destination) && destinationPort === this.config.publicPort)) fail('سرور خروجی نباید به همین پنل برگردد.');
      const file = path.join(this.config.paths.dataDir, 'egress-check-' + crypto.randomBytes(6).toString('hex') + '.json');
      try {
        fs.writeFileSync(file, JSON.stringify(this.egressConfig(ob, 10808)), { mode: 0o600 });
        await new Promise((resolve, reject) => execFile(binary, ['run', '-test', '-c', file], { windowsHide: true, timeout: 15000, maxBuffer: 262144 }, error => error ? reject(Object.assign(new Error('Outbound توسط Xray پذیرفته نشد؛ تنظیمات و نسخهٔ هسته را بررسی کنید.'), { status: 400 })) : resolve()));
      } finally { try { fs.unlinkSync(file); } catch {} }
      return { enabled: true, name, input: input.trim() };
    }
    async startEgress() {
      if (!this.egress.enabled || this.loadError) return;
      const listener = net.createServer(); await new Promise((r, j) => { listener.once('error', j); listener.listen(0, '127.0.0.1', r); });
      this.egressPort = listener.address().port; await new Promise(r => listener.close(r));
      const file = path.join(this.config.paths.dataDir, 'egress-runtime.json'); this.egressFile = file;
      fs.writeFileSync(file, JSON.stringify(this.egressConfig(outbound(this.egress.input), this.egressPort)), { mode: 0o600 });
      await new Promise((r, j) => execFile(this.config.paths.xrayBin, ['run', '-test', '-c', file], { windowsHide: true, timeout: 15000 }, error => error ? j(error) : r()));
      this.launchEgress();
    }
    launchEgress() {
      if (this.stopped) return;
      const child = this.egressProcess = spawn(this.config.paths.xrayBin, ['run', '-c', this.egressFile], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
      child.stderr.on('data', () => {});
      const failed = () => { if (this.stopped || this.egressProcess !== child) return; clearTimeout(this.egressRetry); this.egressRetry = setTimeout(() => this.launchEgress(), 3000); this.egressRetry.unref(); };
      child.on('error', failed); child.on('exit', failed);
    }
    stop() { this.stopped = true; clearTimeout(this.egressRetry); this.egressProcess?.kill(); }
  }
  return { Studio, fromUri, outbound, singboxRoute, fingerprints };
}
module.exports = createConfigStudio;
