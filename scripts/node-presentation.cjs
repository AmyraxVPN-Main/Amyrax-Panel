function createNodePresentation({ axios }) {
  const net = require('net'), dns = require('dns').promises;
  const cache = new Map(), pending = new Map();
  const unknown = () => ({ country: 'Unknown', code: '', flag: '🌐' });
  const publicIp = ip => {
    if (net.isIP(ip) === 4) {
      const [a, b] = ip.split('.').map(Number);
      return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127));
    }
    return net.isIP(ip) === 6 && !/^(::|fc|fd|fe[89ab])/i.test(ip);
  };
  const cached = host => cache.get(host)?.value || unknown();
  async function resolve(host) {
    host = String(host || '').replace(/^\[|\]$/g, '').toLowerCase();
    if (cache.get(host)?.until > Date.now()) return cached(host);
    if (pending.has(host)) return pending.get(host);
    const job = (async () => {
      let value = unknown(), ip = host;
      try {
        if (!net.isIP(ip)) {
          let timer;
          try { ip = (await Promise.race([dns.lookup(host), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('DNS timeout')), 1500); })])).address; }
          finally { clearTimeout(timer); }
        }
        if (publicIp(ip)) {
          for (const url of ['https://freeipapi.com/api/json/', 'https://ipwho.is/']) {
            try {
              const { data } = await axios.get(url + encodeURIComponent(ip), { timeout: 2000, maxContentLength: 16384 });
              const code = String(data.countryCode || data.country_code || '').toUpperCase();
              if (!/^[A-Z]{2}$/.test(code) || ['XX', 'ZZ'].includes(code)) continue;
              const country = new Intl.DisplayNames(['en'], { type: 'region' }).of(code);
              if (!country || country === code) continue;
              value = { code, country, flag: String.fromCodePoint(...[...code].map(c => 127397 + c.charCodeAt(0))) }; break;
            } catch {}
          }
        }
      } catch {}
      if (cache.size >= 256) cache.delete(cache.keys().next().value);
      cache.set(host, { value, until: Date.now() + (value.code ? 6 * 3600000 : 300000) });
      return value;
    })();
    pending.set(host, job);
    try { return await job; } finally { pending.delete(host); }
  }
  function nameNodes(nodes, username, location) {
    const user = String(username || 'کاربر اصلی').replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '').trim() || 'کاربر اصلی';
    const place = location || unknown();
    return nodes.map((node, i) => {
      const name = `${user} · ${place.flag} ${place.country}${nodes.length > 1 ? ' ' + (i + 1) : ''}`;
      const previous = node.name; node.name = name;
      if (node.uri.startsWith('vmess://')) {
        const config = JSON.parse(Buffer.from(node.uri.slice(8), 'base64').toString('utf8'));
        config.ps = name; node.uri = 'vmess://' + Buffer.from(JSON.stringify(config)).toString('base64');
      } else node.uri = node.uri.split('#')[0] + '#' + encodeURIComponent(name);
      if (node.clash) node.clash.name = name;
      for (const ob of node.singboxOutbound || []) if (ob.tag === previous) ob.tag = name;
      if (node.singboxOutbound) node.singboxJson = JSON.stringify(node.singboxOutbound, null, 2);
      return node;
    });
  }
  return { resolve, cached, nameNodes };
}
module.exports = createNodePresentation;
