function createSystemMetrics(options = {}) {
  const fs = options.fs || require('fs'), os = options.os || require('os'), proc = options.process || process;
  const path = require('path').posix;
  const read = file => { try { return fs.readFileSync(file,'utf8').trim(); } catch { return ''; } };
  const exists = file => { try { return fs.existsSync(file); } catch { return false; } };
  const number = text => /^\d+$/.test(text) && Number.isSafeInteger(Number(text)) ? Number(text) : null;
  const linux = os.platform() === 'linux';
  let ticks = options.clockTicks || null, cached = null, cachedAt = 0;
  if (linux && !ticks && !options.fs) {
    require('child_process').execFile('getconf',['CLK_TCK'],{windowsHide:true,timeout:1000,maxBuffer:1024},(error,stdout) => {
      if (!error && number(stdout.trim()) > 0) { ticks = number(stdout.trim()); cachedAt = 0; }
    });
  }
  const decode = value => value.replace(/\\([0-7]{3})/g,(_,n)=>String.fromCharCode(parseInt(n,8)));
  function groups(controller) {
    const memberships = read('/proc/self/cgroup').split('\n').map(line => {
      const [id,controllers,...rest] = line.split(':'); return {id,controllers:controllers?.split(',') || [],dir:rest.join(':')};
    });
    const results = [];
    for (const line of read('/proc/self/mountinfo').split('\n')) {
      const [left,right] = line.split(' - '); if (!right) continue;
      const fields = left.split(' '), extra = right.split(' '), v2 = extra[0] === 'cgroup2';
      if (!v2 && !(extra[0] === 'cgroup' && extra[2]?.split(',').includes(controller))) continue;
      const member = memberships.find(m => v2 ? m.id === '0' : m.controllers.includes(controller));
      if (!member) continue;
      const root = decode(fields[3]), mount = decode(fields[4]);
      let relative = member.dir === root ? '' : member.dir.startsWith(root.replace(/\/$/,'')+'/') ? member.dir.slice(root.length) : member.dir === '/' ? '' : null;
      if (relative === null || relative.split('/').includes('..')) continue;
      let dir = path.join(mount,relative);
      while (dir === mount || dir.startsWith(mount+'/')) {
        results.push({dir,v2}); if (dir === mount) break; dir = path.dirname(dir);
      }
    }
    if (!results.length) {
      if (exists('/sys/fs/cgroup/cgroup.controllers')) results.push({dir:'/sys/fs/cgroup',v2:true});
      else results.push({dir:'/sys/fs/cgroup/'+controller,v2:false});
    }
    return results;
  }
  const memoryGroups = linux ? groups('memory') : [], cpuGroups = linux ? groups('cpu') : [];
  const containerHint = linux && (exists('/.dockerenv') || exists('/run/.containerenv') || /docker|kubepods|containerd|lxc|libpod/.test(read('/proc/1/cgroup')));
  return {
    snapshot() {
      const now = Date.now(); if (cached && now-cachedAt < 1000) return cached;
      const hostTotal = os.totalmem(), hostUsed = Math.max(0,hostTotal-os.freemem());
      const processRss = proc.memoryUsage().rss;
      let allocation = null, groupUsage = null;
      for (const {dir,v2} of memoryGroups) {
        const total = number(read(dir+'/'+(v2?'memory.max':'memory.limit_in_bytes')));
        const used = number(read(dir+'/'+(v2?'memory.current':'memory.usage_in_bytes')));
        if (groupUsage === null && used !== null) groupUsage = used;
        if (total > 0 && total < hostTotal && (!allocation || total < allocation.total)) allocation = {total,used};
      }
      const constrained = typeof proc.constrainedMemory === 'function' ? proc.constrainedMemory() : 0;
      if (constrained > 0 && constrained < hostTotal && (!allocation || constrained < allocation.total)) allocation = {total:constrained,used:groupUsage};
      const scoped = !!allocation || containerHint;
      const memory = allocation ? {...allocation,scope:'allocation'} : containerHint ? {total:null,used:groupUsage,scope:'container'} : {total:hostTotal,used:hostUsed,scope:'host'};
      let cores = os.availableParallelism ? os.availableParallelism() : os.cpus().length;
      for (const {dir,v2} of cpuGroups) {
        const values = v2 ? read(dir+'/cpu.max').split(/\s+/) : [read(dir+'/cpu.cfs_quota_us'),read(dir+'/cpu.cfs_period_us')];
        const quota = number(values[0]), period = number(values[1]);
        if (quota > 0 && period > 0) cores = Math.min(cores,quota/period);
      }
      let uptime = scoped ? null : os.uptime(), uptimeScope = scoped ? 'container' : 'host';
      if (scoped && ticks) {
        const stat = read('/proc/1/stat'), close = stat.lastIndexOf(')');
        const start = close >= 0 ? number(stat.slice(close+2).split(/\s+/)[19]) : null;
        const boot = Number(read('/proc/uptime').split(' ')[0]);
        if (start !== null && Number.isFinite(boot) && boot >= start/ticks) uptime = boot-start/ticks;
      }
      cachedAt = now;
      cached = {os:os.platform(),arch:os.arch(),cores:Math.round(cores*100)/100,processRss,memory,uptime,uptimeScope,panelUptime:proc.uptime(),sampledAt:now};
      return cached;
    }
  };
}
module.exports = createSystemMetrics;
