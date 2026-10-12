function createPanelUpdates() {
  const fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');
  const zlib = require('zlib'), vm = require('vm'), Module = require('module');
  const { spawn } = require('child_process');
  const REPO = 'AmyraxVPN-Main/Amyrax-Panel', RESTART = 75, CHECK_INTERVAL = 60 * 60000;
  const VERSION = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
  const normalize = value => VERSION.test(String(value)) ? String(value).replace(/^v/, '') : '';
  const newer = (a, b) => {
    if (!normalize(a) || !normalize(b)) return false;
    const x = normalize(a).split('.').map(Number), y = normalize(b).split('.').map(Number);
    for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
    return false;
  };
  const issue = (code, message) => Object.assign(new Error(message), { code });
  const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
  function atomic(file, value) {
    const temp = file + '.' + crypto.randomBytes(5).toString('hex') + '.tmp';
    try { fs.writeFileSync(temp, JSON.stringify(value), { mode:0o600 }); fs.renameSync(temp, file); }
    finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
  }
  const crcTable = Array.from({length:256}, (_, n) => { for (let i=0;i<8;i++) n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0; });
  function crc32(data) { let n=0xffffffff;for(const b of data)n=crcTable[(n^b)&255]^(n>>>8);return (n^0xffffffff)>>>0; }
  function unzip(buffer) {
    const bad = () => issue('PACKAGE_INVALID', 'بستهٔ به‌روزرسانی معتبر نیست.');
    if (!Buffer.isBuffer(buffer) || buffer.length < 22 || buffer.length > 32*1024*1024) throw bad();
    let end=-1;
    for(let i=buffer.length-22;i>=Math.max(0,buffer.length-65557);i--) if(buffer.readUInt32LE(i)===0x06054b50 && i+22+buffer.readUInt16LE(i+20)===buffer.length){end=i;break;}
    if(end<0 || buffer.readUInt16LE(end+4) || buffer.readUInt16LE(end+6))throw bad();
    const count=buffer.readUInt16LE(end+10), offset=buffer.readUInt32LE(end+16), size=buffer.readUInt32LE(end+12);
    if(!count||count>512||buffer.readUInt16LE(end+8)!==count||offset+size!==end)throw bad();
    const files=new Map(), names=new Set();let pos=offset,total=0;
    for(let i=0;i<count;i++){
      if(pos+46>end||buffer.readUInt32LE(pos)!==0x02014b50)throw bad();
      const flags=buffer.readUInt16LE(pos+8), method=buffer.readUInt16LE(pos+10), crc=buffer.readUInt32LE(pos+16);
      const compressed=buffer.readUInt32LE(pos+20), length=buffer.readUInt32LE(pos+24), nameLength=buffer.readUInt16LE(pos+28), extra=buffer.readUInt16LE(pos+30), comment=buffer.readUInt16LE(pos+32);
      const local=buffer.readUInt32LE(pos+42), mode=(buffer.readUInt32LE(pos+38)>>>16)&0xf000;
      if(pos+46+nameLength+extra+comment>end||flags&1||![0,8].includes(method)||length>16*1024*1024||compressed>32*1024*1024||mode===0xa000||buffer.readUInt16LE(pos+34))throw bad();
      const name=buffer.subarray(pos+46,pos+46+nameLength).toString('utf8');
      if(!name||name.includes('\\')||name.includes('\0')||name.startsWith('/')||name.includes(':')||name.split('/').some(p=>p==='..'||p==='.'||p.endsWith('.')||p.endsWith(' '))||names.has(name.toLowerCase())||/^(node_modules|\.git|\.review|amyrax-data)\//i.test(name))throw bad();
      names.add(name.toLowerCase());total+=length;if(total>96*1024*1024)throw bad();
      if(local+30>offset||buffer.readUInt32LE(local)!==0x04034b50||buffer.readUInt16LE(local+8)!==method||buffer.readUInt16LE(local+6)!==flags)throw bad();
      const localNameLength=buffer.readUInt16LE(local+26), start=local+30+localNameLength+buffer.readUInt16LE(local+28);
      if(start+compressed>offset||buffer.subarray(local+30,local+30+localNameLength).toString('utf8')!==name)throw bad();
      let data;try {data=method===8?zlib.inflateRawSync(buffer.subarray(start,start+compressed),{maxOutputLength:Math.max(1,length)}):buffer.subarray(start,start+compressed);}catch{throw bad();}
      if(data.length!==length||crc32(data)!==crc)throw bad();
      if(!name.endsWith('/'))files.set(name,data);else if(length)throw bad();
      pos+=46+nameLength+extra+comment;
    }
    if(pos!==end)throw bad();return files;
  }
  function npmCli() {
    const candidates = [process.env.npm_execpath, path.join(path.dirname(process.execPath),'node_modules/npm/bin/npm-cli.js'), path.resolve(path.dirname(process.execPath),'../lib/node_modules/npm/bin/npm-cli.js')];
    try { candidates.push(require.resolve('npm/bin/npm-cli.js')); } catch {}
    return candidates.find(file => file && file.endsWith('.js') && fs.existsSync(file)) || '';
  }
  async function installDependencies(directory) {
    const cli=npmCli();if(!cli)throw issue('NPM_MISSING','ابزار نصب بسته‌ها در این هاست پیدا نشد؛ از فایل نصب استفاده کنید.');
    await new Promise((resolve,reject)=>{
      const child=spawn(process.execPath,[cli,'ci','--omit=dev','--ignore-scripts','--no-audit','--no-fund','--engine-strict','--fetch-retries=2','--fetch-timeout=20000'],{
        cwd:directory,windowsHide:true,stdio:'ignore',env:{...process.env,npm_config_cache:path.join(directory,'.npm-cache')}
      });
      const timer=setTimeout(()=>{child.kill();},240000);
      child.once('error',()=>{clearTimeout(timer);reject(issue('INSTALL_FAILED','نصب بسته‌های نسخهٔ جدید انجام نشد؛ پنل فعلی حفظ شد.'));});
      child.once('exit',code=>{clearTimeout(timer);code===0?resolve():reject(issue('INSTALL_FAILED','نصب بسته‌های نسخهٔ جدید انجام نشد؛ پنل فعلی حفظ شد.'));});
    });
  }
  async function getBytes(url, {headers={},maxBytes=32*1024*1024,timeout=60000}={}) {
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);
    try {
      const response=await fetch(url,{headers,signal:controller.signal});
      if(!response.ok)throw issue('NETWORK','دریافت به‌روزرسانی از GitHub انجام نشد؛ دوباره تلاش کنید.');
      if(Number(response.headers.get('content-length'))>maxBytes)throw issue('PACKAGE_SIZE','بستهٔ به‌روزرسانی بیش از اندازه بزرگ است.');
      const chunks=[];let size=0;
      for await(const chunk of response.body){size+=chunk.length;if(size>maxBytes){controller.abort();throw issue('PACKAGE_SIZE','بستهٔ به‌روزرسانی بیش از اندازه بزرگ است.');}chunks.push(chunk);}
      return Buffer.concat(chunks);
    } finally {clearTimeout(timer);}
  }
  class Manager {
    constructor(options) {
      this.current=normalize(options.current);this.entry=path.resolve(options.entry);this.dataDir=path.resolve(options.dataDir);
      this.home=path.join(this.dataDir,'.amyrax-updates');this.file=path.join(this.home,'state.json');
      this.repo=options.repo===undefined?REPO:options.repo;this.enabled=!!this.repo;
      this.env=options.env||process.env;this.install=options.install||installDependencies;
      this.download=options.download||(asset=>getBytes(asset.browser_download_url));
      this.fetchRelease=options.fetchRelease||(async function(){
        const headers={'User-Agent':'AmyraxPanel/'+this.current,Accept:'application/vnd.github+json'};
        if(this.env.GITHUB_TOKEN)headers.Authorization='Bearer '+this.env.GITHUB_TOKEN;
        return JSON.parse((await getBytes('https://api.github.com/repos/'+this.repo+'/releases/latest',{headers,maxBytes:1024*1024,timeout:12000})).toString('utf8'));
      }).bind(this);
      this.onRestart=options.onRestart;this.inFlight=null;this.job=null;this.stopped=false;
      this.checkInterval=options.checkInterval||CHECK_INTERVAL;this.checkError='';this.lastAttempt=0;
      this.available=null;this.checkedAt=0;this.loadError=false;
      try { if(fs.existsSync(this.file))this.readState(); } catch {this.loadError=true;}
      try { const cached=readJson(path.join(this.home,'release.json'));this.available=this.release(cached.release);this.checkedAt=Number(cached.checkedAt)||0; } catch {}
    }
    ensureHome(){fs.mkdirSync(path.join(this.home,'versions'),{recursive:true,mode:0o700});}
    readState() {
      if(!fs.existsSync(this.file))return {schema:1};
      const state=readJson(this.file);
      if(state.schema!==1)throw issue('STATE_INVALID','اطلاعات به‌روزرسانی قابل خواندن نیست.');
      for(const target of [state.active,state.previous,state.pending])if(target&&(!normalize(target.version)||!/^[0-9]+\.[0-9]+\.[0-9]+-[a-f0-9]{12}$/.test(target.id)))throw issue('STATE_INVALID','اطلاعات به‌روزرسانی قابل خواندن نیست.');
      return state;
    }
    saveState(state){this.ensureHome();atomic(this.file,state);}
    directory(target){return path.join(this.home,'versions',target.id);}
    prune(state){
      const versions=path.join(this.home,'versions'),keep=new Set([state.active?.id,state.previous?.id,state.pending?.id].filter(Boolean));
      if(fs.existsSync(versions))for(const item of fs.readdirSync(versions,{withFileTypes:true})){
        if(item.isDirectory()&&!item.isSymbolicLink()&&/^\d+\.\d+\.\d+-[a-f0-9]{12}$/.test(item.name)&&!keep.has(item.name)){
          const target=path.join(versions,item.name);if(this.inside(target,versions))try{fs.rmSync(target,{recursive:true,force:true});}catch{}
        }
      }
      const backups=path.join(this.home,'backups');
      if(fs.existsSync(backups)){
        const entries=fs.readdirSync(backups,{withFileTypes:true}).filter(item=>item.isDirectory()&&!item.isSymbolicLink()&&/^\d+\.\d+\.\d+-[a-f0-9]{12}$/.test(item.name))
          .sort((a,b)=>fs.statSync(path.join(backups,b.name)).mtimeMs-fs.statSync(path.join(backups,a.name)).mtimeMs);
        for(const item of entries.slice(3)){const target=path.join(backups,item.name);if(this.inside(target,backups))try{fs.rmSync(target,{recursive:true,force:true});}catch{}}
      }
    }
    capability(){
      if(!this.enabled)return 'بررسی به‌روزرسانی با تنظیمات این سرور خاموش شده است.';
      if(this.loadError)return 'اطلاعات به‌روزرسانی قابل خواندن نیست؛ از فایل نصب استفاده کنید.';
      if(!this.env.AMYRAX_SUPERVISED||this.env.AMYRAX_NO_SUPERVISOR==='true'||!this.env.AMYRAX_UPDATE_HOME||path.resolve(this.env.AMYRAX_UPDATE_HOME)!==this.home)return 'برای آپدیت با یک دکمه، پنل را با راه‌انداز پیش‌فرض اجرا کنید.';
      if(this.env.RAILWAY_SERVICE_ID && (!this.env.RAILWAY_VOLUME_MOUNT_PATH || !this.inside(this.dataDir,path.resolve(this.env.RAILWAY_VOLUME_MOUNT_PATH))))return 'برای آپدیت ماندگار روی Railway، یک Volume به پوشهٔ داده‌ها متصل کنید.';
      if(this.env.REPLIT_DEPLOYMENT && !this.env.RAILWAY_VOLUME_MOUNT_PATH)return 'در این میزبانی از استقرار مجدد مخزن استفاده کنید؛ فایل‌های برنامه ماندگار نیستند.';
      if(!this.env.AMYRAX_DATA_DIR&&!this.env.RAILWAY_VOLUME_MOUNT_PATH&&this.inside(this.dataDir,os.tmpdir()))return 'پوشهٔ داده‌ها موقت است؛ مسیر ماندگار AMYRAX_DATA_DIR را مشخص کنید.';
      if(!npmCli()&&this.install===installDependencies)return 'ابزار نصب بسته‌ها در این هاست پیدا نشد؛ از فایل نصب استفاده کنید.';
      try {fs.accessSync(this.dataDir,fs.constants.W_OK);}catch{return 'پوشهٔ داده‌ها قابل نوشتن نیست؛ دسترسی هاست را بررسی کنید.';}
      return '';
    }
    inside(file,base){const r=path.relative(base,file);return !r||(!r.startsWith('..'+path.sep)&&r!=='..'&&!path.isAbsolute(r));}
    release(raw){
      if(!raw||raw.draft||raw.prerelease||!normalize(raw.tag_name))throw issue('RELEASE_INVALID','نسخهٔ منتشرشدهٔ معتبری پیدا نشد.');
      const version=normalize(raw.tag_name), name='Amyrax-Panel-v'+version+'.zip';
      const url='https://github.com/'+this.repo+'/releases/download/'+encodeURIComponent(raw.tag_name)+'/'+name;
      const asset=(raw.assets||[]).find(a=>a.name===name&&a.state==='uploaded'&&a.browser_download_url===url);
      return {version,tag:raw.tag_name,url:'https://github.com/'+this.repo+'/releases/tag/'+encodeURIComponent(raw.tag_name),asset:asset&&/^sha256:[a-f0-9]{64}$/.test(asset.digest||'')&&asset.size>0&&asset.size<=32*1024*1024?{name:asset.name,digest:asset.digest,size:asset.size,browser_download_url:url}:null,raw};
    }
    async check(fresh=false){
      if(!this.enabled)return;
      if(this.inFlight)return this.inFlight;
      if(!fresh && ((this.checkedAt&&Date.now()-this.checkedAt<this.checkInterval)||(this.lastAttempt&&Date.now()-this.lastAttempt<60000)))return;
      this.lastAttempt=Date.now();
      this.inFlight=(async()=>{try{
        const release=this.release(await this.fetchRelease());this.available=release;this.checkedAt=Date.now();this.checkError='';
        try {this.ensureHome();atomic(path.join(this.home,'release.json'),{release:release.raw,checkedAt:this.checkedAt});}catch{}
      }catch{this.checkError='بررسی نسخهٔ جدید انجام نشد؛ اتصال سرور به GitHub را بررسی کنید. اطلاعات آخرین بررسی حفظ شده است.';}})();
      try {await this.inFlight;}finally{this.inFlight=null;}
    }
    status(){
      let state;try {state=this.readState();}catch{this.loadError=true;state={};}
      const reason=this.capability(),latest=this.available?.version||'',hasNewer=newer(latest,this.current);
      const packageReason=hasNewer&&!this.available.asset?'فایل نصب معتبر این ریلیز آماده نیست؛ صفحهٔ ریلیز را بررسی کنید.':'';
      const operation=state.operation||{phase:'idle'};
      return {ok:true,current:this.current,latest,newer:hasNewer,disabled:!this.enabled,canApply:!reason&&!packageReason&&hasNewer,
        reason:reason||packageReason,url:this.available?.url||'https://github.com/'+(this.repo||REPO)+'/releases',checkedAt:this.checkedAt,checkError:this.checkError,
        operation,rollback:state.rollback||null};
    }
    start(){
      this.firstTimer=setTimeout(()=>this.check().catch(()=>{}),8000);this.firstTimer.unref();
      this.timer=setInterval(()=>{if(!this.job)this.check().catch(()=>{});},this.checkInterval);this.timer.unref();
    }
    stop(){this.stopped=true;clearTimeout(this.firstTimer);clearInterval(this.timer);}
    phase(phase,version,error=''){
      const state=this.readState();state.operation={phase,version,updatedAt:Date.now(),...(error?{error}:{})};this.saveState(state);
    }
    begin(version){
      const reason=this.capability();if(reason)throw issue('UNSUPPORTED',reason);
      const state=this.readState();
      if(this.job||state.pending||['downloading','installing','restarting','testing'].includes(state.operation?.phase))throw issue('BUSY','به‌روزرسانی در حال انجام است؛ منتظر بمانید.');
      if(!this.available||!newer(this.available.version,this.current)||normalize(version)!==this.available.version)throw issue('VERSION_CHANGED','نسخهٔ پیشنهادی تغییر کرده است؛ دوباره بررسی کنید.');
      if(!this.available.asset)throw issue('PACKAGE_MISSING','فایل نصب معتبر این ریلیز آماده نیست.');
      const release=this.available;this.phase('downloading',release.version);
      this.job=this.apply(release).catch(error=>{this.phase('failed',release.version,error.code?error.message:'به‌روزرسانی انجام نشد؛ نسخهٔ فعلی حفظ شد. دوباره تلاش کنید.');}).finally(()=>{this.job=null;});
      return this.status();
    }
    async apply(release){
      const target={version:release.version,id:release.version+'-'+crypto.randomBytes(6).toString('hex')},directory=this.directory(target);
      try {
        const bytes=await this.download(release.asset);
        if(bytes.length!==release.asset.size||'sha256:'+crypto.createHash('sha256').update(bytes).digest('hex')!==release.asset.digest)throw issue('DIGEST_MISMATCH','فایل دانلودشده با ریلیز یکسان نیست؛ پنل فعلی حفظ شد.');
        const files=unzip(bytes),required=['index.js','package.json','package-lock.json'];
        if(required.some(name=>!files.has(name)))throw issue('PACKAGE_INVALID','بستهٔ نصب کامل نیست.');
        const code=files.get('index.js').toString('utf8');
        const manifest=JSON.parse(files.get('package.json')),lock=JSON.parse(files.get('package-lock.json'));
        if(!code.includes("const AMYRAX_VERSION = '"+release.version+"';")||manifest.version!==release.version||manifest.name!=='amyrax-panel'||lock.version!==release.version||lock.packages?.['']?.version!==release.version)throw issue('VERSION_MISMATCH','نسخهٔ فایل‌های بسته با ریلیز یکسان نیست.');
        new vm.Script(Module.wrap(code),{filename:'index.js'});
        this.ensureHome();fs.mkdirSync(directory,{mode:0o700});
        // The standalone entry embeds its assets and runtime. Only code and manifests are needed.
        for(const name of required)fs.writeFileSync(path.join(directory,name),files.get(name),{mode:0o600});
        this.phase('installing',release.version);await this.install(directory);
        if(this.stopped)throw issue('CANCELLED','به‌روزرسانی متوقف شد؛ پنل فعلی حفظ شد.');
        const backup=path.join(this.home,'backups',target.id);fs.mkdirSync(backup,{recursive:true,mode:0o700});
        for(const name of ['auth.json','state.json','users.json','traffic.json','custom-configs.json']){
          const file=path.join(this.dataDir,name);if(fs.existsSync(file)){fs.copyFileSync(file,path.join(backup,name));fs.chmodSync(path.join(backup,name),0o600);}
        }
        const state=this.readState();state.pending=target;state.previous=state.active||null;state.rollback=null;
        state.operation={phase:'restarting',version:target.version,updatedAt:Date.now()};this.saveState(state);
        if(!this.onRestart)throw issue('RESTART_UNAVAILABLE','راه‌اندازی مجدد در این اجرا آماده نیست.');
        this.onRestart();
      }catch(error){
        const state=this.readState();if(state.pending?.id===target.id){delete state.pending;this.saveState(state);}
        if(fs.existsSync(directory)&&this.inside(directory,path.join(this.home,'versions')))fs.rmSync(directory,{recursive:true,force:true});
        throw error;
      }
    }
    supervise({config={},args=[],stdio='inherit',startupTimeout=180000,settleTime=15000,healthCheck,onEvent=()=>{}}={}){
      let child=null,stopping=false,startTimer,settleTimer,healthTimer,selected=null,trial=false,rollingBack=false,probing=false;
      const clear=()=>{clearTimeout(startTimer);clearTimeout(settleTimer);clearInterval(healthTimer);startTimer=settleTimer=healthTimer=undefined;};
      const checkHealth=healthCheck||(()=>new Promise(resolve=>{
        const req=require('http').get({host:'127.0.0.1',port:this.env.PORT||this.env.SERVER_PORT||config.publicPort||8080,path:'/healthz',timeout:2000},res=>{res.resume();resolve(res.statusCode===200);});
        req.on('error',()=>resolve(false));req.on('timeout',()=>{req.destroy();resolve(false);});
      }));
      const event=(type,extra={})=>onEvent({type,...extra});
      const rollback=(reason)=>{
        if(rollingBack)return;rollingBack=true;clear();
        const state=this.readState(), failed=state.pending||selected;
        state.active=state.previous||null;state.previous=null;delete state.pending;
        state.rollback={version:failed?.version,at:Date.now(),message:reason};
        state.operation={phase:'rolled-back',version:failed?.version,error:reason,updatedAt:Date.now()};this.saveState(state);
        event('rollback',{version:failed?.version});
      };
      const choose=()=>{
        const state=this.readState();
        if(state.active && !newer(state.active.version,this.current)){state.active=null;state.previous=null;this.saveState(state);}
        if(state.pending && !newer(state.pending.version,this.current)){delete state.pending;state.operation={phase:'complete',version:this.current,updatedAt:Date.now()};state.rollback=null;this.saveState(state);}
        selected=state.pending||state.active||null;trial=!!selected;rollingBack=false;
        if(!state.pending && ['downloading','installing','restarting','testing'].includes(state.operation?.phase)){
          state.operation={phase:'failed',version:state.operation.version,error:'به‌روزرسانی ناتمام ماند؛ نسخهٔ قبلی اجرا شده است. دوباره تلاش کنید.',updatedAt:Date.now()};this.saveState(state);
        }
        if(selected && !fs.existsSync(path.join(this.directory(selected),'index.js'))){
          if(trial){rollback('فایل‌های نسخهٔ جدید کامل نبود؛ نسخهٔ قبلی بازیابی شد.');return choose();}
          state.active=null;state.rollback={version:selected.version,at:Date.now(),message:'فایل‌های نسخهٔ ذخیره‌شده در دسترس نبود؛ نسخهٔ نصب‌شده اجرا شد.'};this.saveState(state);selected=null;
        }
        return selected?path.join(this.directory(selected),'index.js'):this.entry;
      };
      const run=()=>{
        let file;try {file=choose();}catch{this.loadError=true;selected=null;trial=false;file=this.entry;event('state-error');}
        child=spawn(process.execPath,process.execArgv.concat([file,...args]),{cwd:selected?this.directory(selected):process.cwd(),stdio:stdio==='inherit'?['inherit','inherit','inherit','ipc']:['ignore','pipe','pipe','ipc'],windowsHide:true,
          env:{...process.env,AMYRAX_SUPERVISED:'1',AMYRAX_DATA_DIR:this.dataDir,AMYRAX_UPDATE_HOME:this.home,AMYRAX_BOOT_CONFIG:JSON.stringify(config)}});
        event('spawn',{child,version:selected?.version||this.current,trial});
        if(trial){this.phase('testing',selected.version);startTimer=setTimeout(()=>{rollback('نسخهٔ جدید در زمان لازم آماده نشد؛ نسخهٔ قبلی بازیابی شد.');child.kill();},startupTimeout);}
        child.on('message',async message=>{
          if(message?.type!=='amyrax-ready'||!trial||rollingBack||normalize(message.version)!==selected.version)return;
          if(settleTimer)return;
          const running=child;if(!await checkHealth()||child!==running||rollingBack||stopping)return;
          clearTimeout(startTimer);
          healthTimer=setInterval(async()=>{if(probing)return;probing=true;const healthy=await checkHealth();probing=false;
            if(!healthy&&trial&&!stopping&&child===running){rollback('موتورهای اتصال نسخهٔ جدید آماده نماندند؛ نسخهٔ قبلی بازیابی شد.');running.kill();}},2000);
          settleTimer=setTimeout(async()=>{if(!await checkHealth()||child!==running||rollingBack||stopping){if(!stopping&&!rollingBack){rollback('نسخهٔ جدید آماده نشد؛ نسخهٔ قبلی بازیابی شد.');running.kill();}return;}
            const state=this.readState();if((state.pending||state.active)?.id!==selected.id)return;state.active=state.pending||state.active;delete state.pending;
            state.operation={phase:'complete',version:state.active.version,updatedAt:Date.now()};this.saveState(state);trial=false;clear();this.prune(state);event('ready',{version:state.active.version});},settleTime);
        });
        child.once('error',()=>{if(trial)rollback('نسخهٔ جدید اجرا نشد؛ نسخهٔ قبلی بازیابی شد.');});
        child.once('close',code=>{
          clear();if(stopping){event('stopped');return;}
          if(trial&&!rollingBack)rollback('نسخهٔ جدید با خطا متوقف شد؛ نسخهٔ قبلی بازیابی شد.');
          if(rollingBack||code===RESTART){if(rollingBack)this.prune(this.readState());run();return;}
          event('exit',{code:code==null?1:code});
        });
      };
      run();
      return {stop:signal=>{stopping=true;clear();child?.kill(signal||'SIGTERM');},get child(){return child;}};
    }
  }
  return {Manager,newer,normalize,unzip,crc32,installDependencies,REPO,RESTART};
}
module.exports = createPanelUpdates;
