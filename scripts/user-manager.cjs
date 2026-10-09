function createUserManagement({ LinkGenerator, Logger, AmyraxTraffic }) {
  const fs = require('fs'), path = require('path'), crypto = require('crypto'), net = require('net');
  const { spawn, execFile } = require('child_process');
  const DAY = 86400000, GiB = 1073741824;
  const protocols = { vless: 'VLESS', vmess: 'VMess', trojan: 'Trojan', shadowsocks: 'Shadowsocks' };
  const storedProtocols = { ...protocols, trojan: true, httpupgrade: true };
  const secret = () => crypto.randomBytes(24).toString('hex');
  const fail = (message, status = 400) => { const e = new Error(message); e.status = status; throw e; };
  const numeric = (value, label, max) => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max) fail(label + ' باید عددی بین صفر و ' + max + ' باشد.');
    return value;
  };
  const text = (value, label, max, required = false) => {
    if (typeof value !== 'string' || value.length > max || (required ? /[\u0000-\u001f\u007f]/ : /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/).test(value) || (required && !value.trim())) fail(label + ' معتبر نیست.');
    return value.trim();
  };
  class UserManager {
    constructor(config, stateManager) {
      this.config = config; this.stateManager = stateManager;
      this.file = path.join(config.paths.dataDir, 'users.json');
      this.users = []; this.connections = new Map(); this.targets = new Map(); this.generations = new Set();
      this.engine = { status: 'idle', message: 'با اولین کاربر، سرویس اتصال کاربران راه‌اندازی می‌شود.' };
      this.running = false; this.dirty = false; this.revision = 0;
      try {
        if (fs.existsSync(this.file)) {
          const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
          if (saved.version !== 1 || !Array.isArray(saved.users)) throw new Error('Invalid user database');
          const ids = new Set(), keys = new Set(), credentials = new Set([stateManager.state.uuid]);
          for (const u of saved.users) {
            if (!u || !/^[0-9a-f-]{36}$/.test(u.id) || !/^[0-9a-f-]{36}$/.test(u.uuid) || !/^[0-9a-f]{48}$/.test(u.token) || !/^[0-9a-f]{48}$/.test(u.routeKey) || ids.has(u.id) || credentials.has(u.uuid) || keys.has(u.token) || keys.has(u.routeKey)) throw new Error('Invalid user record');
            this.validate(u, u);
            for (const n of ['up', 'down', 'lifetimeUp', 'lifetimeDown']) if (!Number.isSafeInteger(u[n]) || u[n] < 0) throw new Error('Invalid traffic counters');
            for (const n of ['createdAt', 'updatedAt', 'quotaStartedAt']) if (!Number.isFinite(u[n]) || u[n] <= 0) throw new Error('Invalid timestamps');
            if (u.expiresAt !== null && (!Number.isFinite(u.expiresAt) || u.expiresAt <= 0)) throw new Error('Invalid expiration');
            if (!u.history || typeof u.history !== 'object' || Array.isArray(u.history) || Object.entries(u.history).some(([k,v])=>!Number.isFinite(Number(k)) || !v || !Number.isSafeInteger(v.up) || !Number.isSafeInteger(v.down) || v.up<0 || v.down<0 || (v.spanMinutes !== undefined && ![30,60].includes(v.spanMinutes)))) throw new Error('Invalid usage history');
            ids.add(u.id); credentials.add(u.uuid); keys.add(u.token); keys.add(u.routeKey);
          }
          this.users = saved.users;
        }
      } catch (e) {
        this.loadError = 'فایل کاربران خوانده نشد؛ فایل users.json را بررسی یا از نسخهٔ پشتیبان بازیابی کنید.';
        this.engine = { status: 'error', message: this.loadError };
        Logger.error('User database could not be loaded; managed connections remain closed.');
      }
      this.timer = setInterval(() => this.tick(), 1000); this.timer.unref();
    }
    available() { if (this.loadError) fail(this.loadError, 503); }
    validate(input, current = {}, skipUnique = false) {
      if (!input || typeof input !== 'object' || Array.isArray(input)) fail('اطلاعات کاربر معتبر نیست.');
      const allowed = ['name','note','enabled','limitGB','durationDays','startMode','resetDays','protocols','revision'];
      const out = {};
      for (const key of Object.keys(input)) {
        if (!allowed.includes(key)) { if (input === current) continue; fail('تنظیم ناشناخته: ' + key); }
        const v = input[key];
        if (key === 'name' || key === 'note') out[key] = text(v, key === 'name' ? 'نام کاربر' : 'یادداشت', key === 'name' ? 64 : 500, key === 'name');
        if (['limitGB','durationDays','resetDays'].includes(key)) out[key] = numeric(v, key, key === 'limitGB' ? 1000000 : 36500);
        if (key === 'enabled') { if (typeof v !== 'boolean') fail('وضعیت کاربر معتبر نیست.'); out[key] = v; }
        if (key === 'startMode') { if (!['now','first-use'].includes(v)) fail('زمان شروع اعتبار معتبر نیست.'); out[key] = v; }
        if (key === 'protocols') {
          if (!Array.isArray(v) || !v.length || v.length > 5 || v.some(p => !Object.hasOwn(input === current ? storedProtocols : protocols,p)) || new Set(v).size !== v.length) fail('حداقل یک پروتکل معتبر انتخاب کنید.');
          out[key] = v.slice();
        }
      }
      if (!skipUnique && out.name && this.users.some(u => u.id !== current.id && u.name.toLowerCase() === out.name.toLowerCase())) fail('نام کاربر تکراری است.',409);
      return out;
    }
    planImport(backup, reservedToken = '') {
      this.available();
      if(!backup || backup.version!==1 || !Array.isArray(backup.users) || backup.users.length>2000) fail('فایل پشتیبان نسخهٔ ۱ و حداکثر ۲۰۰۰ کاربر لازم است.');
      const fields=['id','uuid','token','routeKey','name','note','enabled','limitGB','durationDays','startMode','resetDays','protocols','revision','createdAt','updatedAt','firstConnectedAt','lastConnectedAt','expiresAt','archivedAt','quotaStartedAt','up','down','lifetimeUp','lifetimeDown','history'];
      const inputIds=new Set(),inputKeys=new Set(),inputUUIDs=new Set();
      const records=backup.users.map((raw,index)=>{
        const invalid=()=>fail('اطلاعات ردیف '+(index+1)+' پشتیبان معتبر نیست؛ هیچ کاربری اضافه نشد.');
        if(!raw || typeof raw!=='object' || Array.isArray(raw) || Object.keys(raw).some(k=>!fields.includes(k)) || fields.some(k=>!Object.hasOwn(raw,k)))invalid();
        if(['id','uuid','token','routeKey'].some(k=>typeof raw[k]!=='string')||!/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(raw.id) || !/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(raw.uuid) || !/^[a-f0-9]{48}$/.test(raw.token) || !/^[a-f0-9]{48}$/.test(raw.routeKey))invalid();
        this.validate(raw,raw,true);
        if(!raw.name.trim() || !Number.isSafeInteger(raw.revision) || raw.revision<1)invalid();
        for(const key of ['up','down','lifetimeUp','lifetimeDown'])if(!Number.isSafeInteger(raw[key])||raw[key]<0)invalid();
        if(!Number.isSafeInteger(raw.up+raw.down)||!Number.isSafeInteger(raw.lifetimeUp+raw.lifetimeDown))invalid();
        for(const key of ['createdAt','updatedAt','quotaStartedAt','firstConnectedAt','lastConnectedAt','expiresAt','archivedAt']){
          const value=raw[key],nullable=['firstConnectedAt','lastConnectedAt','expiresAt','archivedAt'].includes(key);
          if(!(nullable&&value===null)&&(!Number.isSafeInteger(value)||value<=0||value>8640000000000000))invalid();
        }
        if(!raw.history || typeof raw.history!=='object' || Array.isArray(raw.history) || Object.keys(raw.history).length>512)invalid();
        const history=Object.create(null);
        for(const [key,value] of Object.entries(raw.history)){
          if(!/^\d+$/.test(key)||!Number.isSafeInteger(Number(key))||Number(key)<=0||Number(key)>8640000000000000||!value||!Number.isSafeInteger(value.up)||!Number.isSafeInteger(value.down)||value.up<0||value.down<0||!Number.isSafeInteger(value.up+value.down)||(value.spanMinutes!==undefined&&![30,60].includes(value.spanMinutes)))invalid();
          history[key]={up:value.up,down:value.down,...(value.spanMinutes===undefined?{}:{spanMinutes:value.spanMinutes})};
        }
        const id=raw.id.toLowerCase(),uuid=raw.uuid.toLowerCase();
        if(inputIds.has(id)||inputUUIDs.has(uuid)||inputKeys.has(raw.token)||inputKeys.has(raw.routeKey)||raw.token===raw.routeKey)fail('شناسه یا کلید تکراری داخل فایل پشتیبان است؛ هیچ کاربری اضافه نشد.');
        inputIds.add(id);inputUUIDs.add(uuid);inputKeys.add(raw.token);inputKeys.add(raw.routeKey);
        return {...Object.fromEntries(fields.map(key=>[key,raw[key]])),id,uuid,name:raw.name.trim(),history,protocols:raw.protocols.slice()};
      });
      const ids=new Set(this.users.map(u=>u.id.toLowerCase()));
      const uuids=new Set([this.stateManager.state.uuid,...this.users.map(u=>u.uuid)].filter(Boolean).map(s=>s.toLowerCase()));
      const keys=new Set([reservedToken,...this.users.flatMap(u=>[u.token,u.routeKey])].filter(Boolean));
      const names=new Set(this.users.map(u=>u.name.toLowerCase())),additions=[],rows=[];
      let skipped=0,renamed=0;
      for(const u of records){
        if(ids.has(u.id)||uuids.has(u.uuid)||keys.has(u.token)||keys.has(u.routeKey)){
          skipped++;rows.push({name:u.name,action:'skip',reason:'حساب یا کلید از قبل وجود دارد؛ اطلاعات فعلی حفظ می‌شود.'});continue;
        }
        const original=u.name;let suffix=1;
        while(names.has(u.name.toLowerCase())){const tail=' (بازیابی '+(suffix++)+')';u.name=original.slice(0,64-tail.length)+tail;}
        if(u.name!==original)renamed++;
        additions.push(u);rows.push({name:original,newName:u.name,action:u.name===original?'add':'rename'});
        ids.add(u.id);uuids.add(u.uuid);keys.add(u.token);keys.add(u.routeKey);names.add(u.name.toLowerCase());
      }
      if(this.users.length+additions.length>2000)fail('مجموع کاربران پس از بازیابی بیشتر از ظرفیت ۲۰۰۰ حساب است.');
      const fingerprint=crypto.createHash('sha256').update(JSON.stringify({reservedToken,shared:this.stateManager.state.uuid,current:this.users.map(u=>[u.id,u.uuid,u.token,u.routeKey,u.name]),records})).digest('hex');
      return {additions,summary:{total:records.length,added:additions.length,skipped,renamed,rows,fingerprint}};
    }
    importBackup(backup, fingerprint, reservedToken = '') {
      const plan=this.planImport(backup,reservedToken);
      if(typeof fingerprint!=='string'||fingerprint!==plan.summary.fingerprint)fail('اطلاعات کاربران یا فایل تغییر کرده؛ پیش‌نمایش بازیابی را دوباره بررسی کنید.',409);
      if(plan.additions.length){const merged=[...this.users,...plan.additions];this.persist(merged);this.users=merged;this.schedule();}
      return plan.summary;
    }
    persist(users = this.users) {
      fs.mkdirSync(path.dirname(this.file), { recursive:true });
      const tmp = this.file + '.tmp';
      const fd = fs.openSync(tmp, 'w', 0o600);
      try { fs.writeFileSync(fd, JSON.stringify({ version:1, users })); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      fs.renameSync(tmp, this.file); this.dirty = false; this.storageError = false;
    }
    find(id) { this.available(); const u = this.users.find(u => u.id === id); if (!u) fail('کاربر پیدا نشد.',404); return u; }
    byToken(token) { if (this.loadError) return null; return this.users.find(u => !u.archivedAt && u.token === token); }
    status(u, now = Date.now()) {
      if (u.archivedAt) return 'archived';
      if (!u.enabled) return 'disabled';
      if (u.expiresAt && now >= u.expiresAt) return 'expired';
      if (u.limitGB > 0 && u.up + u.down >= Math.floor(u.limitGB * GiB)) return 'limited';
      return u.durationDays > 0 && !u.expiresAt ? 'pending' : 'active';
    }
    permitted(u) { return !this.storageError && ['active','pending'].includes(this.status(u)); }
    create(input) {
      this.available();
      if (this.users.length >= 2000) fail('ظرفیت این فایل کاربران تکمیل شده است.',409);
      const fields = this.validate(input);
      if (!fields.name) fail('نام کاربر الزامی است.');
      const now = Date.now();
      const u = { id:crypto.randomUUID(), uuid:crypto.randomUUID(), token:secret(), routeKey:secret(), name:'', note:'', enabled:true, limitGB:0, durationDays:0, startMode:'now', resetDays:0, protocols:Object.keys(protocols), ...fields, revision:1, createdAt:now, updatedAt:now, firstConnectedAt:null, lastConnectedAt:null, expiresAt:null, archivedAt:null, quotaStartedAt:now, up:0, down:0, lifetimeUp:0, lifetimeDown:0, history:{} };
      if (u.durationDays > 0 && u.startMode === 'now') u.expiresAt = now + u.durationDays * DAY;
      this.persist([...this.users,u]); this.users.push(u); this.schedule(); return u;
    }
    update(id, input) {
      const old = this.find(id);
      if (input.revision !== old.revision) fail('این کاربر در جای دیگری تغییر کرده؛ فهرست را تازه کنید.',409);
      const fields = this.validate(input,old), now = Date.now();
      const u = {...old,...fields,revision:old.revision+1,updatedAt:now};
      if (fields.durationDays !== undefined && fields.durationDays !== old.durationDays || fields.startMode !== undefined && fields.startMode !== old.startMode) {
        u.expiresAt = u.durationDays === 0 || (u.startMode === 'first-use' && !u.firstConnectedAt) ? null : now + u.durationDays * DAY;
      }
      if (fields.resetDays !== undefined && fields.resetDays !== old.resetDays) u.quotaStartedAt = now;
      const users = this.users.map(x => x.id === id ? u : x); this.persist(users); this.users = users;
      const changedProtocols=JSON.stringify(old.protocols)!==JSON.stringify(u.protocols);
      if(!this.permitted(u)||changedProtocols)this.disconnect(id);
      if(changedProtocols) { this.targets.delete(id); this.schedule(); }
      return u;
    }
    remove(id, input) {
      const old = this.find(id);
      if (input?.revision !== old.revision) fail('اطلاعات کاربر تغییر کرده؛ فهرست را تازه کنید.',409);
      const remaining = this.users.filter(u => u.id !== id);
      this.persist(remaining); this.users = remaining;
      this.disconnect(id); this.connections.delete(id); this.targets.delete(id);
      this.schedule();
      return id;
    }
    action(id, input) {
      const old = this.find(id);
      if (input.revision !== old.revision) fail('اطلاعات کاربر تغییر کرده؛ فهرست را تازه کنید.',409);
      const u = {...old, revision:old.revision+1, updatedAt:Date.now()};
      switch (input.action) {
        case 'reset': u.up = 0; u.down = 0; u.quotaStartedAt = Date.now(); break;
        case 'renew': {
          const days = numeric(input.days,'مدت تمدید',36500); u.durationDays = days;
          u.expiresAt = days === 0 ? null : Math.max(Date.now(),u.expiresAt || 0) + days * DAY; u.startMode='now'; break;
        }
        case 'rotate-link': u.token = secret(); break;
        case 'rotate-credentials': u.uuid = crypto.randomUUID(); u.routeKey = secret(); break;
        case 'archive': u.archivedAt = Date.now(); break;
        case 'restore': u.archivedAt = null; break;
        case 'disconnect': break;
        default: fail('عملیات شناخته نشد.');
      }
      const users = this.users.map(x => x.id === id ? u : x); this.persist(users); this.users=users;
      if (input.action !== 'rotate-link') this.disconnect(id);
      if (['rotate-credentials','restore','archive'].includes(input.action)) { this.targets.delete(id); this.schedule(); }
      return u;
    }
    publicUser(u, url) {
      return {...u, protocols:u.protocols.filter(p=>Object.hasOwn(protocols,p)), routeKey:undefined, uuid:undefined, token:undefined, history:undefined, status:this.status(u), usedBytes:u.up+u.down, limitBytes:Math.floor(u.limitGB*GiB), activeConnections:this.connections.get(u.id)?.size || 0, subscriptionUrl:url};
    }
    traffic(u) {
      const now = Date.now(), today = new Date().toISOString().slice(0,10);
      const hourly = Object.entries(u.history).filter(([t])=>Number(t)>=now-8*DAY).map(([t,v])=>({at:Number(t),up:v.up,down:v.down,total:v.up+v.down,spanMinutes:v.spanMinutes||60}));
      return {ok:true,day:{total:hourly.filter(h=>new Date(h.at).toISOString().startsWith(today)).reduce((s,h)=>s+h.total,0)},month:{up:u.up,used:u.up+u.down},allTime:{total:u.lifetimeUp+u.lifetimeDown},limit:{bytes:Math.floor(u.limitGB*GiB),gb:u.limitGB,remaining:u.limitGB ? Math.max(0,u.limitGB*GiB-u.up-u.down):null},history:{since:new Date(u.createdAt).toISOString(),hours:Object.fromEntries(hourly.map(h=>[new Date(h.at).toISOString().slice(0,16),{up:h.up,down:h.down,spanMinutes:h.spanMinutes}]))},since:new Date(u.createdAt).toISOString()};
    }
    generator(u,host) {
      const enable = Object.fromEntries(Object.keys(this.config.enable).map(k=>[k,false]));
      const groups={vless:['vlessWs','vlessWsTls','vlessHttpUpgrade','vlessHttpUpgradeTls','vlessGrpc','vlessGrpcTls','vlessXhttp','vlessXhttpTls','vlessXhttpStream','vlessXhttpStreamTls'],vmess:['vmessWs','vmessWsTls','vmessHttpUpgrade','vmessHttpUpgradeTls','vmessGrpc','vmessGrpcTls'],trojan:['trojanWs','trojanWsTls','trojanHttpUpgrade','trojanHttpUpgradeTls','trojanGrpc','trojanGrpcTls'],shadowsocks:['shadowsocks']};
      for(const [protocol,flags] of Object.entries(groups))for(const flag of flags)enable[flag]=u.protocols.includes(protocol)&&this.config.enable[flag];
      const generator = new LinkGenerator({...this.config,enable,subscriptionName:u.name},{...this.stateManager.state,uuid:u.uuid,shadowsocksPassword:u.uuid},host);
      return generator;
    }
    tick() {
      if (this.loadError || this.stopped) return;
      const now=Date.now();
      for (const u of this.users) {
        if (u.resetDays > 0 && now >= u.quotaStartedAt + u.resetDays*DAY) {
          u.quotaStartedAt += Math.floor((now-u.quotaStartedAt)/(u.resetDays*DAY))*u.resetDays*DAY; u.up=0;u.down=0;this.dirty=true;
        }
        if (!this.permitted(u)) this.disconnect(u.id);
      }
      if (this.dirty) { try { this.persist(); } catch (_) { this.storageError=true; for(const id of this.connections.keys()) this.disconnect(id); } }
    }
    disconnect(id) { for(const c of this.connections.get(id) || []) c.close(); }
    charge(id, direction, bytes) {
      const u=this.users.find(u=>u.id===id);
      if (!u || !this.permitted(u)) return false;
      if (u.limitGB > 0) bytes = Math.min(bytes,Math.max(0,Math.floor(u.limitGB*GiB)-u.up-u.down));
      if (!bytes) { this.disconnect(id); return 0; }
      const now=Date.now();
      if (!u.firstConnectedAt) { u.firstConnectedAt=now; if(u.durationDays>0 && u.startMode==='first-use' && !u.expiresAt) u.expiresAt=now+u.durationDays*DAY; }
      u.lastConnectedAt=now;u[direction]+=bytes;u[direction==='up'?'lifetimeUp':'lifetimeDown']+=bytes;
      const hour=String(Math.floor(now/1800000)*1800000); u.history[hour] ||= {up:0,down:0,spanMinutes:30};u.history[hour][direction]+=bytes;
      for(const t of Object.keys(u.history)) if(Number(t)<now-8*DAY) delete u.history[t];
      this.dirty=true; return bytes;
    }
    start() {this.running=true;this.schedule();}
    schedule() {
      this.revision++;if(!this.running||this.loadError||this.stopped){if(!this.loadError&&this.users.length)this.engine={status:'offline',message:'اطلاعات ذخیره شد؛ سرویس اتصال در این اجرای آزمایشی فعال نیست.'};return;}
      if(this.users.some(u=>!u.archivedAt))this.engine={status:'applying',message:'در حال اعمال تنظیمات اتصال کاربران…'};
      if(this.building){this.rebuildAgain=true;return;}
      this.scheduledAt ||= Date.now();
      const delay=Math.min(750,Math.max(0,2000-(Date.now()-this.scheduledAt)));
      clearTimeout(this.buildTimer);this.buildTimer=setTimeout(()=>{this.scheduledAt=0;this.rebuild();},delay);this.buildTimer.unref();
    }
    async freePort() {
      return new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
    }
    async rebuild() {
      if(this.stopped||this.building)return;
      this.building=true;this.rebuildAgain=false;const revision=this.revision;
      let child=null,file=null;
      try {
        const users=this.users.filter(u=>!u.archivedAt);
        if(!users.length){this.targets=new Map();this.engine={status:'idle',message:'هنوز کاربری ساخته نشده است.'};this.currentGeneration=null;this.retire();return;}
        if(!fs.existsSync(this.config.paths.singboxBin)) throw new Error('موتور sing-box نصب یا راه‌اندازی نشده است.');
        this.engine={status:'applying',message:'در حال اعمال تنظیمات اتصال کاربران…'};
        const generation=secret().slice(0,12),targets=new Map(),inbounds=[],ports=new Set();
        for(const u of users){const entries={};for(const p of u.protocols.filter(p=>Object.hasOwn(protocols,p))){let port;do{port=await this.freePort();}while(ports.has(port));ports.add(port);
          entries[p]={port,generation};inbounds.push({type:p,tag:u.id+'-'+p,listen:'127.0.0.1',listen_port:port,...(p==='shadowsocks'?{method:'aes-256-gcm',password:u.uuid,network:'tcp'}:{users:[{name:u.id,...(p==='trojan'?{password:u.uuid}:{uuid:u.uuid,...(p==='vmess'?{alterId:0}:{})})}]})});
        }targets.set(u.id,entries);}
        file=path.join(this.config.paths.dataDir,'users-engine-'+generation+'.json');
        fs.writeFileSync(file,JSON.stringify({log:{level:'error',timestamp:true},inbounds,outbounds:[{type:'direct',tag:'direct'}],route:{final:'direct'}}),{mode:0o600});
        await new Promise((resolve,reject)=>{
          this.checkProcess=execFile(this.config.paths.singboxBin,['check','-c',file],{windowsHide:true,encoding:'utf8',timeout:15000,maxBuffer:256*1024},error=>{
            this.checkProcess=null;
            if(error)reject(new Error('اعتبارسنجی موتور کاربران ناموفق بود؛ نسخهٔ sing-box را بررسی کنید.'));else resolve();
          });
        });
        if(this.stopped||revision!==this.revision){fs.unlinkSync(file);return;}
        child=spawn(this.config.paths.singboxBin,['run','-c',file],{windowsHide:true,stdio:['ignore','ignore','pipe']});
        let exited=false;child.once('error',()=>{exited=true;});child.once('exit',()=>{exited=true;});child.stderr.on('data',()=>{});
        const deadline=Date.now()+10000;
        for(const port of ports){
          let ready=false;
          while(!ready && !exited && Date.now()<deadline && !this.stopped){
            ready=await new Promise(resolve=>{const s=net.connect(port,'127.0.0.1');let done=false;const finish=v=>{if(done)return;done=true;s.destroy();resolve(v);};s.setTimeout(300,()=>finish(false));s.on('connect',()=>finish(true));s.on('error',()=>finish(false));});
            if(!ready) await new Promise(resolve=>setTimeout(resolve,50));
          }
          if(!ready) throw new Error('سرویس اتصال کاربران آماده نشد.');
        }
        if(this.stopped||revision!==this.revision){child.kill();fs.unlinkSync(file);return;}
        const gen={id:generation,child,file};this.generations.add(gen);this.currentGeneration=generation;this.targets=targets;
        this.engine={status:'ready',message:'سرویس اتصال کاربران آماده است.'};
        child.on('exit',()=>{this.generations.delete(gen);try{fs.unlinkSync(file);}catch(_){}if(this.currentGeneration===generation&&!this.stopped){this.targets.clear();this.engine={status:'error',message:'موتور کاربران متوقف شد؛ تلاش مجدد…'};clearTimeout(this.retryTimer);this.retryTimer=setTimeout(()=>this.schedule(),5000);this.retryTimer.unref();}});
        this.retire();
      } catch(e) {
        if(child)child.kill();if(file)try{fs.unlinkSync(file);}catch(_){}
        if(!this.stopped){this.engine={status:'error',message:e.message};Logger.warn('Managed-user engine setup failed.');}
      } finally {this.building=false;if(this.rebuildAgain&&!this.stopped)this.schedule();}
    }
    retire() {
      const active=new Set([...this.connections.values()].flatMap(s=>[...s].map(c=>c.generation)));
      for(const g of this.generations) if(g.id!==this.currentGeneration&&!active.has(g.id)){this.generations.delete(g);g.child.kill();try{fs.unlinkSync(g.file);}catch(_){}}
    }
    stop() {
      this.stopped=true;this.running=false;clearInterval(this.timer);clearTimeout(this.buildTimer);clearTimeout(this.retryTimer);
      this.checkProcess?.kill();
      for(const id of this.connections.keys())this.disconnect(id);
      for(const g of this.generations)g.child.kill();
      if(!this.loadError&&this.dirty)try{this.persist();}catch(_){}
    }
  }
  UserManager.protocols=protocols;
  return UserManager;
}
module.exports = createUserManagement;
