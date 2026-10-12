'use strict';
const assert=require('assert/strict'),fs=require('fs'),path=require('path'),os=require('os'),crypto=require('crypto'),zlib=require('zlib'),Module=require('module');
const Updates=require('./panel-updates.cjs')(),{Manager}=Updates;
const project=path.resolve(__dirname,'..'),root=fs.mkdtempSync(path.join(os.tmpdir(),'amyrax-updates-tests-'));
const controllers=[],managers=[],servers=[];
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function wait(test,label,timeout=12000){const end=Date.now()+timeout;while(Date.now()<end){if(await test())return;await delay(30);}throw new Error('Timed out: '+label);}
function dataDirectory(name){const dir=path.join(root,name);fs.mkdirSync(dir);return dir;}
function fixtureCode(version,behavior='ready'){
  return "const AMYRAX_VERSION = '"+version+"';\n"+
    "const fs=require('fs'),path=require('path');\n"+
    "process.on('message',message=>{if(message.restart)process.exit(75);});\n"+
    (behavior==='crash'?"setTimeout(()=>process.exit(1),60);\n":behavior==='timeout'?'':
      "setTimeout(()=>process.send?.({type:'amyrax-ready',version:AMYRAX_VERSION,cwd:process.cwd(),boot:JSON.parse(process.env.AMYRAX_BOOT_CONFIG||'{}')}),50);\n")+
    "setInterval(()=>{},1000);\n";
}
function zip(files){
  const local=[],central=[];let offset=0;
  for(const [name,value]of Object.entries(files)){
    const data=Buffer.from(value),compressed=zlib.deflateRawSync(data),n=Buffer.from(name),l=Buffer.alloc(30),c=Buffer.alloc(46);
    l.writeUInt32LE(0x04034b50);l.writeUInt16LE(20,4);l.writeUInt16LE(8,8);l.writeUInt32LE(Updates.crc32(data),14);l.writeUInt32LE(compressed.length,18);l.writeUInt32LE(data.length,22);l.writeUInt16LE(n.length,26);
    c.writeUInt32LE(0x02014b50);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt16LE(8,10);c.writeUInt32LE(Updates.crc32(data),16);c.writeUInt32LE(compressed.length,20);c.writeUInt32LE(data.length,24);c.writeUInt16LE(n.length,28);c.writeUInt32LE(offset,42);
    local.push(l,n,compressed);central.push(c,n);offset+=l.length+n.length+compressed.length;
  }
  const cd=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(Object.keys(files).length,8);end.writeUInt16LE(Object.keys(files).length,10);end.writeUInt32LE(cd.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...local,cd,end]);
}
function release(version,behavior='ready',extra={}){
  const manifest={name:'amyrax-panel',version,scripts:{install:'node -e "require(\'fs\').writeFileSync(\'unsafe-install-script\',\'ran\')"'}};
  const bytes=zip({'index.js':fixtureCode(version,behavior),'package.json':JSON.stringify(manifest),'package-lock.json':JSON.stringify({name:'amyrax-panel',version,lockfileVersion:3,packages:{'':{name:'amyrax-panel',version,hasInstallScript:true}}}),...extra});
  const name='Amyrax-Panel-v'+version+'.zip';
  const raw={tag_name:'v'+version,draft:false,prerelease:false,assets:[{name,state:'uploaded',size:bytes.length,digest:'sha256:'+crypto.createHash('sha256').update(bytes).digest('hex'),browser_download_url:'https://github.com/'+Updates.REPO+'/releases/download/v'+version+'/'+name}]};
  return {bytes,raw};
}
function manager(name,latest,options={}){
  const dataDir=options.dataDir||dataDirectory(name),entry=path.join(dataDir,'seed.cjs');fs.writeFileSync(entry,fixtureCode('1.0.0'));
  const m=new Manager({current:'1.0.0',entry,dataDir,env:{AMYRAX_SUPERVISED:'1',AMYRAX_DATA_DIR:dataDir,AMYRAX_UPDATE_HOME:path.join(dataDir,'.amyrax-updates')},fetchRelease:async()=>latest.raw,download:async()=>latest.bytes,...options});managers.push(m);return m;
}
function launch(m,extra={}){
  const events=[];
  const controller=m.supervise({stdio:'pipe',config:{publicPort:8080,subscriptionName:'Preserved name'},startupTimeout:600,settleTime:180,healthCheck:async()=>true,
    onEvent:event=>{events.push(event);if(event.type==='spawn'){event.child.on('message',message=>events.push({type:'message',message}));event.child.stdout.resume();event.child.stderr.resume();}},...extra});
  controllers.push(controller);m.onRestart=()=>controller.child.send({restart:true});return {controller,events};
}
(async()=>{
  assert.equal(Updates.crc32(Buffer.from('123456789')),0xcbf43926);
  assert(Updates.newer('v1.11.11','1.11.10'));assert(!Updates.newer('1.11.11-beta','1.11.10'));assert(!Updates.newer('v1.11.10','1.11.11'));assert(!Updates.newer('garbage','1.0.0'));
  const good=release('1.0.1'),cache=manager('cache',good,{install:async()=>{}});let count=0,resolveFetch;
  cache.fetchRelease=()=>{count++;return new Promise(resolve=>{resolveFetch=resolve;});};
  const calls=Array.from({length:20},()=>cache.check());resolveFetch(good.raw);await Promise.all(calls);assert.equal(count,1);assert(cache.status().newer);
  await cache.check();assert.equal(count,1);
  cache.fetchRelease=async()=>{throw new Error('offline');};await cache.check(true);assert(cache.status().newer&&cache.status().checkError);
  const restored=new Manager({current:'1.0.0',entry:cache.entry,dataDir:cache.dataDir,install:async()=>{}});assert(restored.status().newer);restored.stop();
  assert.throws(()=>cache.release({...good.raw,prerelease:true}));assert.throws(()=>cache.release({...good.raw,tag_name:'v1.0.1-rc.1'}));
  const unsigned=manager('unsigned',good,{install:async()=>{}});unsigned.fetchRelease=async()=>({...good.raw,assets:good.raw.assets.map(a=>({...a,digest:null}))});await unsigned.check();assert(unsigned.status().newer&&!unsigned.status().canApply);assert.throws(()=>unsigned.begin('1.0.1'));
  assert.throws(()=>Updates.unzip(zip({'../escape':Buffer.from('bad')})));assert.throws(()=>Updates.unzip(zip({'C:/escape':'bad'})));assert.throws(()=>Updates.unzip(zip({'a\\b':'bad'})));assert.throws(()=>Updates.unzip(zip({'package.json':'{}','PACKAGE.JSON':'{}'})));
  const corrupted=Buffer.from(good.bytes);corrupted[35]^=255;assert.throws(()=>Updates.unzip(corrupted));
  console.log('PASS release/version validation, SHA-256 requirement, single GitHub request for concurrent checks, offline cache and safe ZIP parsing.');

  const badDigest=manager('digest',good,{download:async()=>Buffer.from('partial'),install:async()=>{assert.fail('Corrupt package must not be installed');}});
  await badDigest.check();badDigest.begin('1.0.1');await badDigest.job;assert.equal(badDigest.status().operation.phase,'failed');assert(!badDigest.readState().pending);
  const badPackage=release('1.0.1','ready',{'package.json':JSON.stringify({name:'amyrax-panel',version:'2.0.0'})});
  const mismatch=manager('mismatch',badPackage,{install:async()=>assert.fail('Version mismatch must not be installed')});await mismatch.check();mismatch.begin('1.0.1');await mismatch.job;assert.equal(mismatch.status().operation.phase,'failed');
  const failedInstall=manager('install-failure',good,{install:async()=>{throw new Error('installation failure');}});await failedInstall.check();failedInstall.begin('1.0.1');await failedInstall.job;assert.equal(failedInstall.status().operation.phase,'failed');assert(!failedInstall.readState().pending);
  assert.equal(Updates.unzip(fs.readFileSync(path.join(project,'Amyrax-Panel-v1.11.10.zip'))).size,55);
  console.log('PASS truncated downloads, manifest/version mismatch and dependency failures leave the running entry untouched; real release ZIP accepted.');

  const live=manager('live',good);
  const originals=Object.fromEntries(['auth.json','state.json','users.json','traffic.json','custom-configs.json'].map(name=>[name,JSON.stringify({name,secret:crypto.randomUUID()})]));
  for(const[name,value]of Object.entries(originals))fs.writeFileSync(path.join(live.dataDir,name),value);
  const {controller,events}=launch(live);await wait(()=>events.some(e=>e.type==='message'),'seed started');
  await live.check();assert.throws(()=>live.begin('1.0.2'));live.begin('1.0.1');assert.throws(()=>live.begin('1.0.1'),e=>e.code==='BUSY');
  await live.job;await wait(()=>live.readState().operation?.phase==='complete','new version healthy');
  const active=live.readState().active;assert.equal(active.version,'1.0.1');assert(!fs.existsSync(path.join(live.directory(active),'unsafe-install-script')),'npm lifecycle scripts must not execute');
  const ready=events.find(e=>e.type==='message'&&e.message.version==='1.0.1').message;assert.equal(ready.boot.subscriptionName,'Preserved name');assert.equal(ready.cwd,live.directory(active));
  for(const[name,value]of Object.entries(originals)){assert.equal(fs.readFileSync(path.join(live.dataDir,name),'utf8'),value);assert.equal(fs.readFileSync(path.join(live.home,'backups',active.id,name),'utf8'),value);}
  controller.stop();await wait(()=>events.some(e=>e.type==='stopped'),'first supervisor stopped');
  const again=launch(live);await wait(()=>again.events.some(e=>e.type==='message'),'restart from persistent store');assert.equal(again.events.find(e=>e.type==='spawn').version,'1.0.1');again.controller.stop();await wait(()=>again.events.some(e=>e.type==='stopped'),'second supervisor stopped');
  console.log('PASS real npm install, ignored lifecycle scripts, one-click supervised restart, preserved credentials/UUID/users/custom profiles and backup; installed version persists across launcher restarts.');

  const second=release('1.0.2','crash');live.fetchRelease=async()=>second.raw;live.download=async()=>second.bytes;live.install=async()=>{};
  const twice=launch(live);await wait(()=>live.readState().operation?.phase==='complete','installed fallback healthy');
  await live.check(true);live.begin('1.0.2');await live.job;
  await wait(()=>twice.events.filter(e=>e.type==='spawn').length===3,'second update rollback');
  await wait(()=>live.readState().operation?.phase==='complete','restored installed version healthy').catch(error=>{console.error('Second-upgrade state:',live.readState(),'events:',twice.events.map(e=>({type:e.type,version:e.version,message:e.message})));throw error;});
  assert.equal(live.readState().active.version,'1.0.1');assert.equal(live.readState().previous,null);assert.equal(live.status().rollback.version,'1.0.2');
  assert.equal(twice.events.filter(e=>e.type==='spawn').at(-1).version,'1.0.1');
  twice.controller.stop();await wait(()=>twice.events.some(e=>e.type==='stopped'),'second upgrade supervisor stopped');
  console.log('PASS failed subsequent upgrade restores the already-installed version and retains its rollback notice.');

  for(const behavior of ['crash','timeout','health-failure']){
    const bad=release('1.0.1',behavior==='health-failure'?'ready':behavior);
    const m=manager('rollback-'+behavior,bad,{install:async()=>{}});
    const launched=launch(m,behavior==='health-failure'?{healthCheck:async()=>false}:{});
    await wait(()=>launched.events.some(e=>e.type==='message'),'rollback seed started');await m.check();m.begin('1.0.1');await m.job;
    await wait(()=>launched.events.filter(e=>e.type==='spawn').length===3,'rollback '+behavior);
    assert.equal(m.status().operation.phase,'rolled-back');assert.equal(launched.events.filter(e=>e.type==='spawn').at(-1).version,'1.0.0');assert(!m.readState().pending);
    launched.controller.stop();await wait(()=>launched.events.some(e=>e.type==='stopped'),'rollback stopped');
  }
  const broken=manager('broken-store',good,{install:async()=>{}});broken.ensureHome();fs.writeFileSync(broken.file,'{corrupt');const recovered=launch(broken);await wait(()=>recovered.events.some(e=>e.type==='message'),'corrupt store seed');assert(recovered.events.some(e=>e.type==='state-error'));assert(broken.status().reason);recovered.controller.stop();
  const platform=manager('platform',good,{install:async()=>{}});platform.env={RAILWAY_SERVICE_ID:'fixture',AMYRAX_SUPERVISED:'1',AMYRAX_UPDATE_HOME:platform.home};assert.match(platform.capability(),/Volume/);platform.env.RAILWAY_VOLUME_MOUNT_PATH=path.join(root,'other-volume');assert.match(platform.capability(),/Volume/);platform.env.RAILWAY_VOLUME_MOUNT_PATH=platform.dataDir;assert.equal(platform.capability(),'');platform.env.AMYRAX_SUPERVISED='';assert.match(platform.capability(),/راه‌انداز/);
  console.log('PASS automatic rollback on crashing code, readiness timeout and unhealthy engines; corrupt store uses original installation; Railway requires the existing data volume.');

  const entry=path.join(project,'index.js'),loaded=new Module(entry,module);loaded.filename=entry;loaded.paths=Module._nodeModulePaths(project);
  loaded._compile(fs.readFileSync(entry,'utf8')+'\nmodule.exports.testing={buildConfig,StateManager,createHttpPanel,NodePresentation};',entry);
  const {buildConfig,StateManager,createHttpPanel,NodePresentation}=loaded.exports.testing;
  const apiDir=dataDirectory('http-api');process.env.PANEL_PASSWORD='updates-test-'+crypto.randomBytes(18).toString('hex');NodePresentation.resolve=async()=>({country:'Test',code:'',flag:'🌐'});
  const config=buildConfig({...loaded.exports.AMYRAX_CONFIG,dataDirHint:apiDir,domain:'localhost',allowLocalHostLinks:true});
  const updater=manager('api-manager',good,{dataDir:apiDir,install:async()=>{},onRestart:()=>{}});config.panelUpdater=updater;
  const state=new StateManager(config.paths,config);state.loadOrCreate();const {server}=createHttpPanel(config,state,()=>({singbox:true,xray:true}),()=> 'localhost');servers.push(server);
  const port=await new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve(server.address().port))),base='http://127.0.0.1:'+port;
  const login=await fetch(base+'/amyrax/login',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({password:process.env.PANEL_PASSWORD}),redirect:'manual'});assert.equal(login.status,302);
  const cookie=login.headers.get('set-cookie').split(';')[0],headers={Cookie:cookie,'X-Amyrax-Req':'1','Content-Type':'application/json'};
  assert.equal((await fetch(base+'/amyrax/api/update')).status,401);
  assert.equal((await fetch(base+'/amyrax/api/update/check',{method:'POST',headers:{Cookie:cookie}})).status,403);
  assert.equal((await fetch(base+'/amyrax/api/update',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:'{"version":"1.0.1"}'})).status,403);
  const info=await(await fetch(base+'/amyrax/api/update',{headers})).json();assert(info.newer&&info.canApply);
  const apply=await fetch(base+'/amyrax/api/update',{method:'POST',headers,body:'{"version":"1.0.1"}'});assert.equal(apply.status,202);await updater.job;
  assert.equal((await fetch(base+'/amyrax/api/update',{method:'POST',headers,body:'{"version":"1.0.1"}'})).status,409);
  const publicToken=JSON.parse(fs.readFileSync(path.join(apiDir,'auth.json'))).subToken;
  assert.equal((await fetch(base+'/amyrax/api/update?token='+publicToken)).status,401);
  const html=await(await fetch(base+'/amyrax',{headers})).text();assert(html.includes('updateNotice')&&html.includes('updateDialog')&&html.includes('updates.js?v='));
  assert.equal((await fetch(base+'/amyrax-assets/updates.js')).status,200);
  console.log('PASS authenticated update APIs, CSRF checks, duplicate-click conflict, subscriber exclusion and embedded update UI assets.');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{
  for(const manager of managers)manager.stop();for(const controller of controllers)controller.stop();
  for(const server of servers){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  await delay(300);
  const resolved=path.resolve(root);assert(resolved.startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(resolved).startsWith('amyrax-updates-tests-'));
  fs.rmSync(root,{recursive:true,force:true});
});
