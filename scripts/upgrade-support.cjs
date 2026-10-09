function createUpgradeSupport({ fs, path }) {
  const previousPanel = 'knight', previousDirectory = 'bk-data';
  return {
    prepareEnvironment() {
      for (const [oldName,newName] of [['BK_DATA_DIR','AMYRAX_DATA_DIR'],['BK_SUPERVISED','AMYRAX_SUPERVISED'],['BK_NO_SUPERVISOR','AMYRAX_NO_SUPERVISOR']]) {
        if (process.env[newName] === undefined && process.env[oldName] !== undefined) process.env[newName] = process.env[oldName];
      }
    },
    panel(value) { return value === previousPanel ? 'amyrax' : value; },
    cookie(cookies) { return cookies.amyrax_session || cookies.bk_session || ''; },
    expiredCookie: 'bk_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0',
    requestHeader(req) { return req.get('x-amyrax-req') || req.get('x-bk-req'); },
    redirect(req,res,next,panelPath) {
      const url = req.originalUrl;
      const assets = '/' + previousPanel + '-assets';
      const panel = '/' + previousPanel;
      if (url === assets || url.startsWith(assets+'/')) return res.redirect(307,'/amyrax-assets'+url.slice(assets.length));
      if (url === panel || url.startsWith(panel+'/') || url.startsWith(panel+'?')) return res.redirect(307,'/'+panelPath+url.slice(panel.length));
      next();
    },
    dataPath(directory) {
      const source = path.resolve(directory);
      if (path.basename(source) !== previousDirectory) return source;
      const target = path.join(path.dirname(source),'amyrax-data');
      if (path.dirname(target) !== path.dirname(source) || source === target) throw new Error('Invalid data migration path.');
      const oldExists = fs.existsSync(source), newExists = fs.existsSync(target);
      if (oldExists && newExists) throw new Error('Two data directories exist. Set AMYRAX_DATA_DIR to the store you want to use.');
      if (oldExists) fs.renameSync(source,target);
      return target;
    },
    previousDataDirectories(cwd,app,tmp) { return [...new Set([cwd,app,tmp])].map(dir=>path.join(dir,previousDirectory)); }
  };
}
module.exports = createUpgradeSupport;
