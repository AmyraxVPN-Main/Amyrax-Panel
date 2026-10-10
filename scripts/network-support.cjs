function createNetworkSupport({ axios, Logger }) {
  const net = require('net'), http = require('http'), https = require('https');
  const dns = require('dns').promises, crypto = require('crypto');
  const botDomain = value => /(^|\.)apps\.bot-hosting\.cloud$/i.test(host(value));
  const edgeDomain = host => botDomain(host) || /(^|\.)(up\.railway\.app|replit\.app)$/i.test(host || '');
  function host(value) {
    let input = String(value || '').trim();
    if (!input || /[\s\\@]/.test(input)) return '';
    if (net.isIP(input)) return input.toLowerCase();
    try {
      const parsed = new URL(input.includes('://') ? input : 'http://' + input);
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return '';
      return parsed.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
    } catch { return ''; }
  }
  function publicIp(value) {
    let ip = host(value);
    const family = net.isIP(ip);
    if (family === 4) {
      const [a,b,c] = ip.split('.').map(Number);
      return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254)
        || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
        || (a === 100 && b >= 64 && b <= 127) || (a === 198 && [18,19].includes(b))
        || (a === 192 && b === 0 && [0,2].includes(c)) || (a === 198 && b === 51 && c === 100)
        || (a === 203 && b === 0 && c === 113));
    }
    if (family === 6) {
      ip = new URL('http://[' + ip + ']').hostname.slice(1, -1);
      if (/^::ffff:/i.test(ip)) {
        const tail = ip.slice(7), parts = tail.split(':');
        if (net.isIP(tail) === 4) return publicIp(tail);
        if (parts.length === 2) {
          const packed = (parseInt(parts[0],16) * 65536 + parseInt(parts[1],16)) >>> 0;
          return publicIp([packed >>> 24,(packed >>> 16) & 255,(packed >>> 8) & 255,packed & 255].join('.'));
        }
        return false;
      }
      return /^[23][0-9a-f]{3}:/.test(ip) && !/^2001:db8:/.test(ip);
    }
    return false;
  }
  const publicHost = value => {
    const name = host(value);
    if (!name) return false;
    if (net.isIP(name)) return publicIp(name);
    return name.length <= 253 && name.includes('.') && !/(^|\.)(localhost|local|internal|test|invalid|example|replit\.dev)$/.test(name)
      && name.split('.').every(part => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(part));
  };
  function origin(config, name) {
    const learned = config.learnedPublicOrigin;
    const related = learned && (host(name) === host(learned) || (config.forceHost && host(config.domain) === host(learned)));
    const explicit = config.subBase || config.publicBaseUrl || (related ? learned : '');
    if (explicit) {
      const parsed = new URL(explicit);
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) throw Error('PUBLIC_BASE_URL must be an HTTP(S) URL without credentials, a query or a fragment.');
      return parsed;
    }
    const address = host(name), ipv6 = net.isIP(address) === 6 ? '[' + address + ']' : address;
    const secure = config.forceHttps || edgeDomain(address);
    return new URL((secure ? 'https://' : 'http://') + ipv6 + (secure ? '' : ':' + config.publicPort));
  }
  function linkEndpoint(config, name) {
    const address = host(name);
    let publicUrl;
    try { publicUrl = origin(config, address); } catch {}
    const related = publicUrl && (host(publicUrl.hostname) === address || (config.forceHost && host(config.domain) === host(publicUrl.hostname)));
    const edge = edgeDomain(address) || (related && publicUrl.protocol === 'https:');
    const override = process.env.LINK_PORT;
    const port = override ? Number(override) : related ? Number(publicUrl.port || (publicUrl.protocol === 'https:' ? 443 : 80)) : edge ? 443 : config.publicPort;
    const tls = process.env.LINK_TLS !== undefined ? ['true','1'].includes(process.env.LINK_TLS) : edge;
    return {host:address, port, tls, sni:config.forceHost && config.domain ? config.domain : related ? host(publicUrl.hostname) : address};
  }
  async function discoverIp(options = {}) {
    const request = options.request || axios.get.bind(axios);
    const controller = new AbortController();
    try {
      return await Promise.any([
        ['https://api.ipify.org?format=text', value => value],
        ['https://ifconfig.me/ip', value => value],
        ['https://1.1.1.1/cdn-cgi/trace', value => String(value).match(/^ip=([^\r\n]+)$/m)?.[1]],
      ].map(async ([url, extract]) => {
        const response = await request(url, {timeout:3500, maxContentLength:4096, signal:controller.signal, responseType:'text'});
        const ip = String(extract(response.data) || '').trim();
        if (!net.isIP(ip) || !publicIp(ip)) throw Error('No valid public IP');
        return ip;
      }));
    } catch { return ''; } finally { controller.abort(); }
  }
  const failure = (code, message) => Object.assign(new Error(message), {code});
  async function addresses(name, lookup = dns.lookup.bind(dns), allowLocal = false) {
    let timer;
    try {
      const result = net.isIP(name) ? [{address:name, family:net.isIP(name)}] : await Promise.race([
        lookup(name, {all:true}),
        new Promise((_, reject) => { timer = setTimeout(() => reject(failure('DNS_TIMEOUT','پاسخ DNS به‌موقع دریافت نشد.')), 4000); }),
      ]);
      if (!result.length) throw failure('DNS_EMPTY','برای این دامنه هیچ IP پیدا نشد.');
      if (!allowLocal && result.some(item => !publicIp(item.address))) throw failure('PRIVATE_ADDRESS','آدرس عمومی به IP خصوصی یا غیرقابل‌مسیریابی اشاره می‌کند.');
      return result.sort((a,b) => a.family - b.family);
    } finally { clearTimeout(timer); }
  }
  function probe(url, ip, challenge, proof, websocket = false, options = {}) {
    return new Promise((resolve, reject) => {
      const started = Date.now(), secure = url.protocol === 'https:', key = crypto.randomBytes(16).toString('base64');
      const target = new URL(url);
      target.pathname = websocket ? '/Telegram=@AmyraxVPN' : target.pathname.replace(/\/$/, '') + '/.well-known/amyrax-connectivity';
      target.search = websocket ? '' : '?challenge=' + challenge;
      const transport = secure ? https : http;
      const request = transport.request(target, {
        agent:false, family:ip.family, rejectUnauthorized:true,
        lookup:(_, options, callback) => callback(null, options.all ? [ip] : ip.address, ip.family),
        headers:websocket ? {Connection:'Upgrade',Upgrade:'websocket','Sec-WebSocket-Version':'13','Sec-WebSocket-Key':key} : {Accept:'application/json','Cache-Control':'no-store'},
      });
      const timer = setTimeout(() => request.destroy(failure('CONNECT_TIMEOUT','اتصال به آدرس عمومی در مهلت بررسی برقرار نشد.')), options.timeoutMs || 6000);
      let settled = false;
      const done = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(value); };
      request.once('upgrade', (response, socket) => {
        const expected = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
        socket.destroy();
        if (!websocket) return done(failure('WRONG_ENDPOINT','ورودی پنل پاسخ معتبر به بررسی اتصال نداد.'));
        if (response.statusCode !== 101 || response.headers['sec-websocket-accept'] !== expected) return done(failure('WS_INVALID','پاسخ WebSocket معتبر نیست.'));
        done(null, {latencyMs:Date.now()-started});
      });
      request.once('response', response => {
        if (websocket) { response.destroy(); return done(failure('WS_UNAVAILABLE','ورودی عمومی اجازهٔ اتصال WebSocket نمی‌دهد (HTTP '+response.statusCode+').')); }
        const chunks = []; let size = 0;
        response.on('data', chunk => {
          size += chunk.length;
          if (size > 4096) response.destroy(failure('PROBE_RESPONSE','پاسخ بررسی بیش از حد بزرگ است.'));
          else chunks.push(chunk);
        });
        response.once('error', error => done(error));
        response.once('aborted', () => done(failure('PROBE_ABORTED','پاسخ بررسی اتصال ناقص دریافت شد.')));
        response.once('end', () => {
          let body; try { body = JSON.parse(Buffer.concat(chunks).toString()); } catch {}
          if (response.statusCode !== 200 || body?.proof !== proof) return done(failure('WRONG_ENDPOINT','این آدرس به همین پنل نرسید؛ دامنه، پورت و تنظیمات هاست را بررسی کنید.'));
          done(null, {latencyMs:Date.now()-started});
        });
      });
      request.once('error', error => done(error)); request.end();
    });
  }
  class Diagnostics {
    constructor(config, options = {}) {
      this.config = config; this.options = options; this.secret = crypto.randomBytes(32);
      this.result = {state:'pending',checkedAt:null,checks:[],message:'بررسی آدرس عمومی پس از راه‌اندازی انجام می‌شود.',iranReachability:'unverified'};
    }
    proof(challenge) { return crypto.createHmac('sha256', this.secret).update(challenge).digest('hex'); }
    snapshot() { return this.result; }
    async check(name, engines = {}) {
      const config = this.config;
      let url;
      try { url = origin(config, name); } catch {}
      const key = url?.origin || String(name);
      if (this.pending?.key === key) return this.pending.promise;
      if (this.result.endpoint === key && Date.now() - Date.parse(this.result.checkedAt) < 60000) return this.result;
      const run = async () => {
        const checks = [];
        const add = (id, state, message, extra = {}) => checks.push({id,state,message,...extra});
        if (!url || !publicHost(url.hostname)) add('endpoint','error','آدرس عمومی معتبر تنظیم نشده است؛ دامنهٔ فعال‌شده در Bot-Hosting یا IP و پورت تخصیص‌یافته را وارد کنید.');
        else {
          add('endpoint','ok','آدرس عمومی از نظر ساختار معتبر است.');
          try {
            const ips = await addresses(host(url.hostname), this.options.lookup);
            add('dns','ok','آدرس عمومی در DNS پیدا شد.',{addresses:ips.map(item=>item.address)});
            const challenge = crypto.randomBytes(16).toString('hex');
            let response, used, lastError;
            for (const ip of ips.slice(0,2)) {
              try { response = await (this.options.probe || probe)(url,ip,challenge,this.proof(challenge)); used = ip; break; }
              catch (error) { lastError = error; }
            }
            if (!response) throw lastError;
            add('panel','ok','آدرس عمومی به همین پنل رسید.',response);
            add('tls',url.protocol === 'https:' ? 'ok' : 'warning',url.protocol === 'https:' ? 'گواهی HTTPS و نام دامنه معتبرند.' : 'اشتراک با HTTP ارائه می‌شود؛ برای افزودن آسان در v2rayNG دامنهٔ HTTPS فعال کنید.');
            try {
              await (this.options.probe || probe)(url,used,challenge,this.proof(challenge),true);
              add('websocket','ok','ورودی WebSocket برای کانفیگ‌های WS در دسترس است.');
            } catch (error) { add('websocket','warning',error.message); }
          } catch (error) {
            const tlsError = /CERT|TLS|SSL|SELF_SIGNED|UNABLE_TO_VERIFY/.test(error.code || '');
            add(tlsError ? 'tls' : 'panel','error',tlsError ? 'گواهی HTTPS معتبر نیست یا با دامنه مطابقت ندارد؛ گواهی و دامنهٔ هاست را بررسی کنید.' : error.message,{code:error.code || 'NETWORK_ERROR'});
          }
        }
        add('engines',engines.singbox || engines.xray ? 'ok' : 'warning',engines.singbox || engines.xray ? 'حداقل یک موتور اتصال فعال است.' : 'موتور اتصال هنوز آماده نیست؛ گزارش نصب موتور را بررسی کنید.');
        if (url) {
          const endpoint = linkEndpoint(config,config.forceHost || name);
          const publicPort = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
          const sameHost = endpoint.host === host(url.hostname);
          if (!sameHost) add('link','warning','آدرس اتصال با آدرس پنل متفاوت است؛ دسترسی IP یا هاست جایگزین باید جداگانه آزموده شود.');
          else if (endpoint.port !== publicPort || endpoint.tls !== (url.protocol === 'https:')) add('link','warning','پورت یا TLS کانفیگ با ورودی پنل متفاوت است؛ LINK_PORT و LINK_TLS را بررسی کنید.');
          else add('link','ok','آدرس، پورت و TLS کانفیگ با تنظیمات ورودی هماهنگ‌اند.');
        }
        add('iran','unverified','دسترسی از اینترنت ایران باید از همان شبکهٔ کاربر آزموده شود؛ بررسی سرور وضعیت فیلترینگ اپراتورها را تأیید نمی‌کند.');
        const state = checks.some(check=>check.state === 'error') ? 'error' : checks.some(check=>check.state === 'warning') ? 'warning' : 'ok';
        this.result = {state,endpoint:key,checkedAt:new Date().toISOString(),checks,iranReachability:'unverified',message:state === 'ok' ? 'آدرس عمومی و ورودی اتصال از سمت سرور بررسی شدند.' : 'موارد گزارش‌شده را پیش از تحویل اشتراک بررسی کنید.'};
        return this.result;
      };
      const promise = run(); this.pending = {key,promise};
      try { return await promise; } finally { if (this.pending?.promise === promise) this.pending = null; }
    }
  }
  return {host,publicIp,publicHost,botDomain,edgeDomain,origin,linkEndpoint,discoverIp,Diagnostics,addresses,probe};
}
module.exports = createNetworkSupport;
