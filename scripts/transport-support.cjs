function createTransportSupport({ Logger }) {
  const fs = require('fs'), path = require('path'), net = require('net');
  const { spawn, execFile } = require('child_process');
  const variants = [
    ['vless','xhttp',false,'vlessXhttpStream','stream-up'],
    ['vless','httpupgrade',false,'vlessHttpUpgrade'],
    ['vmess','httpupgrade',false,'vmessHttpUpgrade'],
    ['vless','xhttp',false,'vlessXhttp','packet-up'],
    ['shadowsocks','ws',false,'shadowsocks'],
    ['vmess','ws',false,'vmessWs'],
    ['trojan','ws',false,'trojanWs'],
    ['trojan','httpupgrade',false,'trojanHttpUpgrade'],
    ['vmess','grpc',false,'vmessGrpc'],
    ['trojan','grpc',false,'trojanGrpc'],
    ['vless','grpc',false,'vlessGrpc']
  ];
  function nodes(g) {
    const result = [], host = g.host.replace(/^\[|\]$/g,''), address = net.isIP(host) === 6 ? '['+host+']' : host;
    for (const [protocol, transport, nativeTls, flag, mode] of variants) {
      if (!g.config.enable[flag]) continue;
      if (g.edgeTls && (transport === 'grpc' || protocol === 'shadowsocks')) continue;
      if (['grpc','xhttp'].includes(transport) && !g.config.transportState?.[transport]) continue;
      const tls = nativeTls || g.edgeTls;
      const kind = {vless:'VLESS',vmess:'VMess',trojan:'Trojan',shadowsocks:'Shadowsocks'}[protocol];
      const type = kind + '-' + {ws:'WS',httpupgrade:'HTTPUpgrade',grpc:'gRPC',xhttp:'XHTTP'}[transport] + (mode==='stream-up'?'-Stream':'') + (tls?'-TLS':'');
      const name = type, wsHost = tls ? g.tlsOpt.wsHost : host;
      const alpn = [transport === 'grpc' || (transport==='xhttp'&&tls) ? 'h2' : 'http/1.1'];
      const password = protocol === 'shadowsocks' ? (g.state.shadowsocksPassword || g.state.uuid) : g.state.uuid;
      const ob = {type:protocol,tag:name,server:host,server_port:g.port,connect_timeout:'15s'};
      const clash = {name,type:protocol === 'shadowsocks'?'ss':protocol,server:host,port:g.port};
      if (['vless','vmess'].includes(protocol)) { ob.uuid=g.state.uuid;clash.uuid=g.state.uuid; }
      else { ob.password=password;clash.password=password; }
      if (protocol === 'vmess') { ob.security='auto';ob.alter_id=0;clash.cipher='auto';clash.alterId=0; }
      if (tls) {
        ob.tls={...g._sbTls(),alpn};g._clashTls(clash,protocol==='trojan'?'sni':'servername');clash.alpn=alpn;
      } else clash.tls=false;
      if (transport === 'grpc') {
        ob.transport={type:'grpc',service_name:g.grpcService};clash.network='grpc';clash['grpc-opts']={'grpc-service-name':g.grpcService};
      } else {
        ob.transport={type:transport,path:g.wsPath,...(transport==='httpupgrade'?{host:wsHost}:{headers:{Host:wsHost}})};
        clash.network=transport;clash['ws-opts']={path:g.wsPath,headers:{Host:wsHost}};
      }
      let uri;
      if (protocol === 'vmess') {
        uri='vmess://'+Buffer.from(JSON.stringify({v:'2',ps:name,add:host,port:String(g.port),id:g.state.uuid,aid:'0',scy:'auto',net:transport,type:transport==='grpc'?'gun':'none',host:wsHost,path:transport==='grpc'?g.grpcService:g.wsPath,tls:tls?'tls':'',...(tls?{sni:g.tlsOpt.sni,alpn:alpn.join(','),fp:g.tlsOpt.fp,insecure:g.insecure?'1':'0'}:{})})).toString('base64');
      } else if (protocol === 'shadowsocks') {
        const opts='mode=websocket;host='+wsHost+';path='+g.wsPath+';mux=0';
        uri='ss://'+Buffer.from('aes-256-gcm:'+password).toString('base64url')+'@'+address+':'+g.port+'?plugin='+encodeURIComponent('v2ray-plugin;'+opts)+'#'+encodeURIComponent(name);
        delete ob.transport;delete ob.tls;ob.method='aes-256-gcm';ob.plugin='v2ray-plugin';ob.plugin_opts=opts;
        delete clash.network;delete clash['ws-opts'];delete clash.tls;clash.cipher='aes-256-gcm';clash.plugin='v2ray-plugin';
        clash['plugin-opts']={mode:'websocket',tls:false,host:wsHost,path:g.wsPath,mux:false};
      } else {
        const q=new URLSearchParams({...(protocol==='vless'?{encryption:'none'}:{}),security:tls?'tls':'none',type:transport});
        if (tls) {q.set('sni',g.tlsOpt.sni);q.set('alpn',alpn.join(','));if(g.tlsOpt.fp)q.set('fp',g.tlsOpt.fp);if(g.insecure){q.set('insecure','1');q.set('allowInsecure','1');}}
        if (transport==='grpc') {q.set('serviceName',g.grpcService);q.set('mode','gun');}
        else {q.set('host',wsHost);q.set('path',g.wsPath);if(transport==='xhttp')q.set('mode',mode);}
        uri=protocol+'://'+encodeURIComponent(password)+'@'+address+':'+g.port+'?'+q+'#'+encodeURIComponent(name);
      }
      result.push({name,type,protocol,transport,tls,mode,label:type,compat:true,uri,
        clash: transport==='httpupgrade'||transport==='xhttp'||(protocol==='trojan'&&!tls)?null:clash,
        singboxOutbound:transport==='xhttp'?undefined:[ob],
        singboxJson:transport==='xhttp'?undefined:JSON.stringify([ob],null,2)});
    }
    return result;
  }
  function forClient(nodes, userAgent, client = '') {
    if (client==='streisand' || (client!=='v2rayng'&&/streisand/i.test(userAgent))) return nodes.filter(n=>['ws','grpc'].includes(n.transport)&&n.protocol!=='shadowsocks'&&(n.protocol!=='trojan'||n.tls));
    if (client==='v2rayng' || /v2rayng/i.test(userAgent)) return nodes.filter(n=>n.protocol!=='shadowsocks');
    if (/hiddify/i.test(userAgent)) return nodes.filter(n=>n.transport!=='xhttp'&&n.protocol!=='shadowsocks');
    return nodes;
  }
  async function tlsFrontend(config, gateway, handler, certs) {
    const http=require('http'), http2=require('http2');
    const panel=http.createServer(handler),panelPort=await listen(panel),sessions=new Set(),sockets=new Set();
    const server=http2.createSecureServer({...certs,allowHTTP1:true},(req,res)=>{
      if(req.httpVersionMajor!==2){handler(req,res);return;}
      const headers=Object.fromEntries(Object.entries(req.headers).filter(([k])=>!k.startsWith(':')&&k!=='connection'));
      headers.host=req.headers[':authority']||'localhost';
      headers['x-forwarded-proto']='https';
      let upstream;
      let pathname;try{pathname=decodeURIComponent(String(req.url).split('?')[0]);}catch{pathname='';}
      const isGrpc=String(req.headers['content-type']||'').startsWith('application/grpc') && /^\/Telegram=@AmyraxVPN\/(?:Tun|TunMulti)$/.test(pathname);
      if(isGrpc) {
        const port=config.transportState?.grpc;
        if(!port){res.writeHead(503);res.end();return;}
        const session=req.stream.session;
        if(!session.amyraxUpstream||session.amyraxPort!==port||session.amyraxUpstream.destroyed){
          session.amyraxUpstream?.close();session.amyraxPort=port;
          session.amyraxUpstream=http2.connect('http://127.0.0.1:'+port);
          session.amyraxUpstream.on('error',()=>{if(!session.destroyed)session.destroy();});
        }
        upstream=session.amyraxUpstream.request({':path':req.url,':method':req.method,...headers});
        upstream.on('response',h=>{if(res.destroyed)return;res.writeHead(h[':status']||200,Object.fromEntries(Object.entries(h).filter(([k])=>!k.startsWith(':'))));upstream.pipe(res);});
        upstream.on('trailers',h=>{if(!res.destroyed)res.addTrailers(h);});
      } else {
        upstream=http.request({host:'127.0.0.1',port:panelPort,path:req.url,method:req.method,headers,agent:false},reply=>{
          const out=Object.fromEntries(Object.entries(reply.headers).filter(([k])=>!['connection','keep-alive','transfer-encoding','upgrade'].includes(k)));
          if(res.destroyed){reply.destroy();return;}
          res.writeHead(reply.statusCode,out);res.flushHeaders();reply.on('error',()=>res.destroy());reply.pipe(res);
        });
      }
      upstream.on('error',()=>{if(!res.headersSent){res.writeHead(502);res.end();}else res.destroy();});
      req.on('error',()=>upstream.destroy());req.pipe(upstream);
      res.on('close',()=>{if(!res.writableFinished)upstream.destroy();});
    });
    server.on('session',session=>{sessions.add(session);session.on('error',()=>{});session.on('close',()=>{sessions.delete(session);session.amyraxUpstream?.destroy();});});
    server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
    server.on('upgrade',(req,socket,head)=>gateway.handleUpgrade(req,socket,head));
    server.closeAllConnections=()=>{for(const s of sessions)s.destroy();for(const s of sockets)s.destroy();panel.closeAllConnections();panel.close();};
    server.on('close',()=>server.closeAllConnections());
    return server;
  }
  const listen = server => new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>resolve(server.address().port));});
  const freePort = async()=>{const server=net.createServer();const port=await listen(server);await new Promise(r=>server.close(r));return port;};
  class Bridge {
    constructor(config,gateway) {this.config=config;this.gateway=gateway;this.servers=[];this.sockets=new Set();config.transportState ||= {grpc:0,xhttp:0};}
    async start() {
      const state=this.config.transportState;
      state.grpc=0;state.xhttp=0;
      const inbounds=[],ports={};
      try {
        for(const network of ['grpc','xhttp']) {
          if(!variants.some(([,transport,,flag])=>transport===network&&this.config.enable[flag]))continue;
          const server=net.createServer(socket=>{this.sockets.add(socket);socket.once('close',()=>this.sockets.delete(socket));this.gateway.accept(socket,network==='grpc'?'gRPC':'XHTTP');});
          this.servers.push(server);const destination=await listen(server);const port=await freePort();ports[network]=port;
          inbounds.push({listen:'127.0.0.1',port,protocol:'dokodemo-door',tag:network,settings:{address:'127.0.0.1',port:destination,network:'tcp'},streamSettings:{network,security:'none',...(network==='grpc'?{grpcSettings:{serviceName:'Telegram=@AmyraxVPN'}}:{xhttpSettings:{path:'/Telegram=@AmyraxVPN',mode:'auto'}})}});
        }
        if(!inbounds.length)return false;
        this.file=path.join(this.config.paths.dataDir,'transports.json');
        fs.writeFileSync(this.file,JSON.stringify({log:{loglevel:'warning'},inbounds,outbounds:[{protocol:'freedom'}]}),{mode:0o600});
        await new Promise((resolve,reject)=>execFile(this.config.paths.xrayBin,['run','-test','-c',this.file],{windowsHide:true,timeout:15000,maxBuffer:262144},error=>error?reject(error):resolve()));
        this.process=spawn(this.config.paths.xrayBin,['run','-c',this.file],{windowsHide:true,stdio:['ignore','ignore','pipe']});
        this.process.stderr.on('data',()=>{});
        let failed=false;const failure=()=>{failed=true;state.grpc=0;state.xhttp=0;if(!this.stopped){Logger.warn('Transport engine stopped; gRPC and XHTTP subscriptions are temporarily hidden.');clearTimeout(this.retry);this.retry=setTimeout(()=>{this.cleanup();this.start();},5000);this.retry.unref();}};
        this.process.once('error',failure);this.process.once('exit',failure);
        for(const port of Object.values(ports)) {
          let ready=false;const deadline=Date.now()+10000;
          while(!ready&&!failed&&!this.stopped&&Date.now()<deadline) {
            ready=await new Promise(resolve=>{const s=net.connect(port,'127.0.0.1');const done=value=>{s.destroy();resolve(value);};s.setTimeout(300,()=>done(false));s.once('connect',()=>done(true));s.once('error',()=>done(false));});
            if(!ready)await new Promise(r=>setTimeout(r,50));
          }
          if(!ready)throw new Error('Transport listener did not become ready');
        }
        Object.assign(state,ports);Logger.success('gRPC and XHTTP transports ready.');return true;
      } catch(error) {Logger.warn('Additional transports unavailable: '+error.message.split('\n')[0]);this.cleanup();return false;}
    }
    cleanup() {if(this.process){this.process.removeAllListeners('exit');this.process.removeAllListeners('error');this.process.on('error',()=>{});this.process.kill();this.process=null;}for(const s of this.sockets)s.destroy();for(const s of this.servers)s.close();this.servers=[];this.config.transportState.grpc=0;this.config.transportState.xhttp=0;}
    stop() {this.stopped=true;clearTimeout(this.retry);this.cleanup();}
  }
  return {nodes,forClient,tlsFrontend,Bridge,variants};
}
module.exports = createTransportSupport;
