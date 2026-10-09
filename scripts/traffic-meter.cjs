function createTrafficMeter({ Logger, platformName, now = Date.now, monotonic = () => require('perf_hooks').performance.now() }) {
  const fs = require('fs'), path = require('path');
  const KEYS = ['VLESS-WS', 'VMess-WS', 'Trojan-WS', 'Shadowsocks-WS', 'VLESS-XHTTP', 'VLESS-HTTPUpgrade', 'VMess-HTTPUpgrade', 'Trojan-HTTPUpgrade', 'VLESS-gRPC', 'VMess-gRPC', 'Trojan-gRPC', 'Other'];
  const GIB = 1024 * 1024 * 1024;
  const utcDay = (d = new Date(now())) => d.toISOString().slice(0, 10);
  const utcMonth = (d = new Date(now())) => d.toISOString().slice(0, 7);
  let file = null; let st = null; let dirty = false; let lastSave = 0; let writable = false;
  const live = { up: 0, down: 0 }; let samples = [], previous = null, timer = null;
  const identities = new Map();
  const active = {};
  const warned = {};
  let prunedHour = '';
  const fresh = () => ({ v: 1, since: new Date(now()).toISOString(), historySince: new Date(now()).toISOString(), hours: {}, allTime: {}, day: { key: utcDay(), per: {} }, month: { key: utcMonth(), per: {}, baseBytes: 0 } });
  const norm = (label) => { const base=String(label).replace(/-TLS$/,''); return KEYS.includes(base) ? base : 'Other'; };
  const bump = (bucket, k, up, down) => { const e = bucket[k] || (bucket[k] = { up: 0, down: 0 }); e.up += up; e.down += down; };
  const sum = (per) => { let up = 0; let down = 0; for (const k of Object.keys(per || {})) { up += per[k].up || 0; down += per[k].down || 0; } return { up, down, total: up + down }; };
  const limitBytes = () => { const g = parseFloat(process.env.TRAFFIC_LIMIT_GB || ''); return isFinite(g) && g > 0 ? g * GIB : 0; };
  function roll() {
    if (!st) return;
    const d = utcDay(); const m = utcMonth();
    if (st.day.key !== d) { st.day = { key: d, per: {} }; dirty = true; }
    if (st.month.key !== m) { st.month = { key: m, per: {}, baseBytes: 0 }; dirty = true; for (const k of Object.keys(warned)) delete warned[k]; }
    const hour = new Date(now()).toISOString().slice(0, 13);
    if (prunedHour !== hour) {
      const oldest = new Date(now() - 8 * 86400000).toISOString().slice(0, 16);
      for (const key of Object.keys(st.hours || {})) { if (key < oldest) { delete st.hours[key]; dirty = true; } }
      prunedHour = hour;
    }
  }
  function save() {
    if (!file || !st) return;
    try {
      const tmp = file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(st), 'utf8');
      fs.renameSync(tmp, file);
      dirty = false; lastSave = now(); writable = true;
    } catch (err) { writable = false; if (!warned.save) { warned.save = 1; Logger.warn('Could not save traffic.json: ' + err.message); } }
  }
  function checkLimit() {
    const lim = limitBytes(); if (!lim) return;
    const used = sum(st.month.per).total + (st.month.baseBytes || 0);
    const pct = used / lim * 100;
    if (pct >= 100 && !warned.p100) { warned.p100 = 1; warned.p80 = 1; Logger.warn(`Traffic: 100% of TRAFFIC_LIMIT_GB used this month (estimate). Check your host's usage page.`); }
    else if (pct >= 80 && !warned.p80) { warned.p80 = 1; Logger.warn(`Traffic: 80% of TRAFFIC_LIMIT_GB used this month (estimate).`); }
  }
  function tick() {
    const time = now(), stamp = monotonic();
    if (previous && stamp-previous.stamp >= 1000) {
      const windowSeconds = (stamp-previous.stamp)/1000;
      samples.push({t:time,upBps:(live.up-previous.up)/windowSeconds,downBps:(live.down-previous.down)/windowSeconds,windowSeconds});
      if (samples.length > 60) samples.shift();
      previous = {stamp,up:live.up,down:live.down};
    }
    roll();
    if (dirty && time - lastSave > 30000) { save(); checkLimit(); }
  }
  return {
    KEYS,
    init(dataDir) {
      clearInterval(timer); samples=[]; live.up=0;live.down=0;previous={stamp:monotonic(),up:0,down:0};
      identities.clear(); for(const key of Object.keys(active))delete active[key];
      file = path.join(dataDir, 'traffic.json');
      try { st = JSON.parse(fs.readFileSync(file, 'utf8')); if (!st || st.v !== 1) st = fresh(); } catch (_) { st = fresh(); }
      st.allTime = st.allTime || {}; st.day = st.day || { key: utcDay(), per: {} }; st.month = st.month || { key: utcMonth(), per: {}, baseBytes: 0 };
      st.hours = st.hours || {}; st.historySince = st.historySince || new Date(now()).toISOString();
      roll(); save();
      timer = setInterval(tick, 1000); timer.unref();
      process.once('exit', () => { try { save(); } catch (_) {} });
      const lim = limitBytes();
      Logger.info(`Traffic meter: ${file}${lim ? ` (limit ${(lim / GIB).toFixed(2)} GiB/month)` : ''}`);
    },
    add(label, up, down) {
      if (!Number.isSafeInteger(up) || !Number.isSafeInteger(down) || up<0 || down<0) return;
      if (!st || (!up && !down)) return;
      roll();
      const k = norm(label);
      bump(st.allTime, k, up, down); bump(st.day.per, k, up, down); bump(st.month.per, k, up, down);
      const slot = new Date(Math.floor(now() / 1800000) * 1800000).toISOString().slice(0, 16);
      const entry = st.hours[slot] || (st.hours[slot] = { up: 0, down: 0, spanMinutes: 30 });
      entry.up += up; entry.down += down;
      live.up += up; live.down += down; dirty = true;
    },
    meter(label, client, backend) {
      const k = norm(label), end = this.open(k);
      client.on('data', (b) => this.add(k, b.length, 0));
      backend.on('data', (b) => this.add(k, 0, b.length));
      client.once('close', end); backend.once('close', end);
    },
    open(label, identity = null) {
      const k = norm(label); active[k] = (active[k] || 0) + 1;
      if(identity)identities.set(identity,(identities.get(identity)||0)+1);
      let done=false;return()=>{if(done)return;done=true;active[k]=Math.max(0,(active[k]||1)-1);
        if(identity){const count=(identities.get(identity)||1)-1;if(count>0)identities.set(identity,count);else identities.delete(identity);}
      };
    },
    save,
    reset() { st = fresh(); for (const k of Object.keys(warned)) delete warned[k]; save(); },
    setMonthUsedGB(gb) { roll(); st.month.baseBytes = Math.round(gb * GIB) - sum(st.month.per).total; dirty = true; save(); checkLimit(); },
    snapshot() {
      if (!st) return { ok: false, error: 'not started' };
      tick();
      const sample = samples[samples.length-1] || {t:now(),upBps:0,downBps:0,windowSeconds:0};
      const month = sum(st.month.per); const base = st.month.baseBytes || 0;
      const lim = limitBytes(); const used = month.total + base;
      const n = new Date(now()); const next = new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() + 1, 1));
      return {
        ok: true, keys: KEYS, platform: platformName(), now: n.toISOString(), since: st.since, persisted: writable, file: path.basename(file || ''),
        day: { key: st.day.key, per: st.day.per, ...sum(st.day.per) },
        month: { key: st.month.key, per: st.month.per, ...month, baseBytes: base, used, resetsAt: next.toISOString() },
        allTime: { per: st.allTime, ...sum(st.allTime) },
        history: { since: st.historySince, hours: { ...st.hours } },
        live: {...sample,samples:samples.map(s=>({...s}))}, active: { ...active },
        connections:{tunnels:Object.values(active).reduce((a,b)=>a+b,0),accounts:identities.size,sharedOnline:identities.has('shared'),managedOnline:identities.size-(identities.has('shared')?1:0)},
        limit: lim ? { bytes: lim, used, remaining: Math.max(0, lim - used), pct: used / lim * 100, level: used >= lim ? 'over' : (used >= lim * 0.8 ? 'warn' : 'ok') } : null
      };
    }
  };
}
module.exports = createTrafficMeter;
