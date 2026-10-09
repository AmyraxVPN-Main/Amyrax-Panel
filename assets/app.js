async function amyraxRequestJson(url, options = {}) {
  const { timeoutMs = 20000, signal, ...settings } = options;
  const method = String(settings.method || 'GET').toUpperCase(), readOnly = method === 'GET';
  const controller = new AbortController();
  let timedOut = false;
  const cancel = () => controller.abort();
  signal?.addEventListener('abort', cancel, {once:true});
  if (signal?.aborted) cancel();
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  const uncertain = readOnly ? '' : ' نتیجهٔ عملیات مشخص نیست؛ پیش از تکرار، وضعیت را در پنل تازه‌سازی و بررسی کنید.';
  const error = (code, message, status = 0, retryable = false) => Object.assign(new Error(message), {code, status, retryable});
  try {
    for (let attempt = 0; ; attempt++) {
      try {
        if (controller.signal.aborted) throw new Error('aborted');
        const response = await fetch(url, {...settings, method, cache:'no-store', credentials:'same-origin', signal:controller.signal});
        if (response.status === 401) throw error('AUTH_REQUIRED', 'نشست مدیریت پایان یافته است؛ دوباره وارد پنل شوید.', 401);
        const text = await response.text();
        let data;
        try { data = JSON.parse(text); } catch (_) {}
        const valid = data && typeof data === 'object' && !Array.isArray(data);
        if (!response.ok) {
          const message = valid && typeof data.error === 'string' ? data.error
            : response.status === 503 ? 'سرور مشغول است؛ چند ثانیه بعد دوباره تلاش کنید.'
            : 'دریافت پاسخ از سرور ناموفق بود (HTTP ' + response.status + ').' + uncertain;
          throw error('HTTP_ERROR', message, response.status, [502,504].includes(response.status));
        }
        if (!valid) throw error('INVALID_RESPONSE', 'پاسخ کامل و معتبری از سرور دریافت نشد.' + uncertain, response.status, true);
        return data;
      } catch (failure) {
        if (controller.signal.aborted) throw error(timedOut ? 'REQUEST_TIMEOUT' : 'REQUEST_CANCELLED',
          (timedOut ? 'مهلت دریافت پاسخ از سرور تمام شد.' : 'دریافت پاسخ لغو شد.') + uncertain);
        const failureInfo = ['AUTH_REQUIRED','HTTP_ERROR','INVALID_RESPONSE'].includes(failure.code) ? failure : error('NETWORK_ERROR', 'ارتباط با سرور قطع شد؛ اتصال را بررسی کنید.' + uncertain, 0, true);
        if (!readOnly || attempt >= 1 || !failureInfo.retryable) throw failureInfo;
        await new Promise(resolve => {
          const finish = () => { clearTimeout(retryTimer); controller.signal.removeEventListener('abort', finish); resolve(); };
          const retryTimer = setTimeout(finish, 300);
          controller.signal.addEventListener('abort', finish, {once:true});
          if (controller.signal.aborted) finish();
        });
      }
    }
  } finally {
    clearTimeout(timer); signal?.removeEventListener('abort', cancel);
  }
}

let panelData = null;

function showToast(text) {
  const toast = document.getElementById('amyraxToast');
  if (!toast) return;
  toast.innerText = text;
  toast.classList.add('show');
  setTimeout(() => {
    toast.classList.remove('show');
  }, 2200);
}

function copyTextToClipboard(text) {
  if (!text) return;
  const successMsg = 'در کلیپ‌بورد کپی شد.';

  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(() => {
      showToast(successMsg);
    }).catch(() => {
      fallbackCopy(text, successMsg);
    });
  } else {
    fallbackCopy(text, successMsg);
  }
}

function fallbackCopy(text, msg) {
  const textArea = document.createElement('textarea');
  textArea.value = text;
  textArea.style.position = 'fixed';
  textArea.style.opacity = '0';
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();
  try {
    document.execCommand('copy');
    showToast(msg);
  } catch (err) {
    showToast('کپی ناموفق بود.');
  }
  document.body.removeChild(textArea);
}

function openQr(text, title) {
  if (!text) return;
  const modal = document.getElementById('qrModal');
  const wrapper = document.getElementById('qrcodeWrapper');
  const titleEl = document.getElementById('qrModalTitle');
  if (!modal || !wrapper) return;

  if (titleEl && title) {
    titleEl.innerText = title;
  } else if (titleEl) {
    titleEl.innerText = 'اسکن کد QR';
  }

  try {
    qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];
    const code = qrcode(0, 'M'); code.addData(text); code.make();
    wrapper.innerHTML = code.createSvgTag({ cellSize: 4, margin: 16, scalable: true });
  } catch (_) { showToast('این کانفیگ برای QR طولانی است؛ از دکمهٔ کپی استفاده کنید.'); return; }

  modal.classList.add('active');
}

function closeQr() {
  document.getElementById('qrModal')?.classList.remove('active');
}

document.getElementById('qrCloseBtn')?.addEventListener('click', closeQr);
document.getElementById('qrModal')?.addEventListener('click', (e) => {
  if (e.target.id === 'qrModal') closeQr();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeQr();
});

function applyTheme(theme) {
  const isCozy = (theme === 'cozy');
  const targetTheme = isCozy ? 'cozy' : 'dark';

  document.documentElement.setAttribute('data-theme', targetTheme);
  document.body.setAttribute('data-theme', targetTheme);

  if (isCozy) {
    document.body.classList.add('theme-cozy');
  } else {
    document.body.classList.remove('theme-cozy');
  }

  const toggleBtn = document.getElementById('themeToggleBtn');
  const toggleLabel = document.getElementById('themeToggleLabel');
  if (toggleBtn) {
    toggleBtn.setAttribute('data-theme', targetTheme);
    toggleBtn.setAttribute('aria-pressed', isCozy ? 'true' : 'false');
    toggleBtn.classList.toggle('is-cozy', isCozy);
  }
  if (toggleLabel) {
    toggleLabel.textContent = isCozy ? 'Cozy' : 'Dark';
  }
}

function initTheme() {
  let savedTheme = 'dark';
  try { savedTheme = localStorage.getItem('amyrax-theme') || 'dark'; } catch {}
  applyTheme(savedTheme);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || (document.body.classList.contains('theme-cozy') ? 'cozy' : 'dark');
  const nextTheme = (current === 'cozy') ? 'dark' : 'cozy';
  applyTheme(nextTheme);
  try {
    localStorage.setItem('amyrax-theme', nextTheme);
  } catch {}
  showToast(nextTheme === 'cozy' ? 'تم گرم فعال شد.' : 'تم تیره فعال شد.');
}

document.getElementById('themeToggleBtn')?.addEventListener('click', toggleTheme);
initTheme();

document.addEventListener('click', (e) => {
  if (e.target.matches('.node-uri-input')) e.target.select();
  const btn = e.target.closest('button, a');
  if (!btn) return;

  const action = btn.getAttribute('data-action');
  if (!action) return;

  if (action === 'copy-input') {
    const targetId = btn.getAttribute('data-target');
    const input = document.getElementById(targetId);
    if (input) copyTextToClipboard(input.value);
  } else if (action === 'qr-input') {
    const targetId = btn.getAttribute('data-target');
    const input = document.getElementById(targetId);
    if (input) openQr(input.value, 'کد QR اشتراک');
  } else if (action === 'copy-text') {
    const raw = btn.getAttribute('data-text');
    if (raw) copyTextToClipboard(decodeURIComponent(raw));
  } else if (action === 'qr-text') {
    const raw = btn.getAttribute('data-text');
    const title = btn.getAttribute('data-title') || 'اسکن کد QR';
    if (raw) openQr(decodeURIComponent(raw), title);
  }
});

function handleRouting() {
  let hash = window.location.hash || '#/home';
  if (hash === '#' || hash === '') hash = '#/home';
  const page = hash.replace(/^#\/?/, '').split('?')[0].toLowerCase() || 'home';

  let validPage = 'home';
  if (page === 'subs' || page === 'sub') {
    validPage = 'subs';
  } else if (page === 'nodes' || page === 'node') {
    validPage = 'nodes';
  } else if (page === 'users') {
    validPage = 'users';
  } else if (page === 'usage' || page === 'traffic') {
    validPage = 'usage';
  }

  document.querySelectorAll('.view-page').forEach(el => {
    el.classList.remove('active');
  });

  let targetViewId = 'viewHome';
  if (validPage === 'subs') targetViewId = 'viewSubs';
  else if (validPage === 'nodes') targetViewId = 'viewNodes';
  else if (validPage === 'usage') targetViewId = 'viewUsage';
  else if (validPage === 'users') targetViewId = 'viewUsers';

  const targetView = document.getElementById(targetViewId);
  if (targetView) targetView.classList.add('active');

  document.querySelectorAll('.nav-link, .mob-link, .drawer-nav-item').forEach(el => {
    if (el.getAttribute('data-page') === validPage) {
      el.classList.add('active');
    } else {
      el.classList.remove('active');
    }
  });

  amyraxPageTitle(validPage);
  toggleDrawer(false);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

window.addEventListener('hashchange', handleRouting);

const hamburgerBtn = document.getElementById('hamburgerBtn');
const mobileDrawer = document.getElementById('mobileDrawer');

function toggleDrawer(open) {
  if (!hamburgerBtn || !mobileDrawer) return;
  const isOpen = (typeof open === 'boolean') ? open : !mobileDrawer.classList.contains('open');
  mobileDrawer.classList.toggle('open', isOpen);
  hamburgerBtn.classList.toggle('active', isOpen);
  hamburgerBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
  document.getElementById('drawerScrim')?.classList.toggle('open', isOpen);
  const smallScreen = window.matchMedia('(max-width: 850px)').matches;
  mobileDrawer.inert = smallScreen && !isOpen;
  mobileDrawer.setAttribute('aria-hidden', smallScreen && !isOpen ? 'true' : 'false');
}

hamburgerBtn?.addEventListener('click', (e) => {
  e.stopPropagation();
  toggleDrawer();
});

mobileDrawer?.querySelectorAll('a').forEach(link => {
  link.addEventListener('click', () => toggleDrawer(false));
});

document.addEventListener('click', (e) => {
  if (mobileDrawer?.classList.contains('open')) {
    if (!mobileDrawer.contains(e.target) && !hamburgerBtn?.contains(e.target)) {
      toggleDrawer(false);
    }
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && mobileDrawer?.classList.contains('open')) {
    toggleDrawer(false);
  }
});

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function renderNodes(nodes, locationStr) {
  const container = document.getElementById('nodesContainer');
  if (!container) return;

  const activeNodes = (nodes || []).filter(n => {
    if (!n || !n.uri) return false;
    const lowerType = (n.type || '').toLowerCase();
    return !lowerType.includes('hy2') && !lowerType.includes('hysteria');
  });

  if (activeNodes.length === 0) {
    container.innerHTML = `
      <div class="no-nodes-msg">
        <p>کانفیگی پیدا نشد. وضعیت موتورهای اتصال را بررسی کنید.</p>
      </div>
    `;
    return;
  }

  let html = '';
  activeNodes.forEach((node, index) => {
    const rawUri = node.uri;
    const name = node.name || `AmyraxVPN - Node ${index + 1}`;
    const lowerType = (node.type || '').toLowerCase();

    let protoLabel = 'VLESS';
    let protoClass = 'badge-proto-vless';
    if (lowerType.includes('vmess')) {
      protoLabel = 'VMess';
      protoClass = 'badge-proto-vmess';
    } else if (lowerType.includes('trojan')) {
      protoLabel = 'Trojan';
      protoClass = 'badge-proto-trojan';
    } else if (lowerType.includes('shadowsocks') || lowerType === 'ss') {
      protoLabel = 'Shadowsocks';
      protoClass = 'badge-proto-ss';
    } else if (lowerType.includes('wireguard') || lowerType.includes('wg')) {
      protoLabel = 'WireGuard';
      protoClass = 'badge-proto-wg';
    } else if (lowerType.includes('tuic')) {
      protoLabel = 'TUIC';
      protoClass = 'badge-proto-tuic';
    }

    let transportBadge = '';
    if (lowerType.includes('ws')) {
      transportBadge = '<span class="node-badge-tag">WS</span>';
    } else if (lowerType.includes('httpupgrade')) {
      transportBadge = '<span class="node-badge-tag">HTTPUpgrade</span>';
    } else if (lowerType.includes('grpc')) {
      transportBadge = '<span class="node-badge-tag">gRPC</span>';
    } else if (lowerType.includes('xhttp')) {
      transportBadge = '<span class="node-badge-tag">XHTTP</span>';
    }

    let secBadge = '';
    if (lowerType.includes('reality')) {
      secBadge = '<span class="node-badge-tag badge-reality">Reality</span>';
    } else if (lowerType.includes('tls') || lowerType.includes('shadowtls')) {
      secBadge = '<span class="node-badge-tag badge-tls">TLS</span>';
    }

    const encodedUri = encodeURIComponent(rawUri);
    const encodedTitle = escapeHtml(name);

    html += `
      <div class="node-item-card">
        <div class="node-card-header">
          <div class="node-card-title-group">
            <span class="proto-badge ${protoClass}">${protoLabel}</span>
            <h4 class="node-remark-title" title="${escapeHtml(name)}">${escapeHtml(name)}</h4>
          </div>
          <div class="node-badges-group">
            ${transportBadge}
            ${secBadge}
          </div>
        </div>

        <div class="node-card-meta">
          <div class="node-location-tag">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="loc-icon">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
              <circle cx="12" cy="10" r="3"></circle>
            </svg>
            <span>${escapeHtml(locationStr || 'Global Server')}</span>
          </div>
          ${node.note ? `<div class="node-location-tag" style="opacity:.85;font-size:.78rem">${escapeHtml(node.note)}</div>` : ''}
        </div>

        <div class="node-uri-box">
          <input type="text" class="node-uri-input" readonly value="${escapeHtml(rawUri)}">
        </div>

        <div class="node-actions-row">
          <span class="row-actions" dir="rtl">
            <button type="button" class="action-icon-button" data-action="qr-text" data-text="${encodedUri}" data-title="${encodedTitle}" aria-label="کد QR ${escapeHtml(node.name || node.type)}" title="نمایش کد QR"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2v2h-2zM14 18h2v2h-2zM18 18h2v2h-2z"/></svg></button>
            <button type="button" class="action-icon-button" data-action="copy-text" data-text="${encodedUri}" aria-label="کپی ${escapeHtml(node.name || node.type)}" title="کپی لینک"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>
          </span>
          ${node.wgConf ? `
            <a href="/amyrax/wg.conf" download="wg0.conf" class="btn-node-dl" title="Download WireGuard Profile">
              <span>.conf</span>
            </a>
          ` : ''}
        </div>
      </div>
    `;
  });

  container.innerHTML = html;
}

async function loadGateData() {
  try {
    const pathSegments = window.location.pathname.split('/').filter(Boolean);
    const pathPrefix = pathSegments[0] || 'amyrax';

    const data = await amyraxRequestJson('/health');
    panelData = data;
    updateAmyraxOverview(data);

    const pubPort = data.publicPort || window.location.port || '2705';
    const serverHost = data.domain || data.host || window.location.hostname;
    const locationStr = data.location || 'Global Server';

    const uptimeStr = amyraxDuration(data.uptime);

    const homeLocation = document.getElementById('homeLocation');
    if (homeLocation) homeLocation.innerText = locationStr;

    const homePort = document.getElementById('homePort');
    if (homePort) homePort.innerText = pubPort;

    const homeUptime = document.getElementById('homeUptime');
    if (homeUptime) homeUptime.innerText = uptimeStr;

    const statLocation = document.getElementById('statLocation');
    if (statLocation) statLocation.innerText = locationStr;

    const statPort = document.getElementById('statPort');
    if (statPort) statPort.innerText = pubPort;

    const statHost = document.getElementById('statHost');
    if (statHost) statHost.innerText = serverHost;

    const statUptime = document.getElementById('statUptime');
    if (statUptime) statUptime.innerText = uptimeStr;

    const nodesLocation = document.getElementById('nodesLocation');
    if (nodesLocation) nodesLocation.innerText = locationStr;

    const engines = [];
    if (data.engines?.singbox) engines.push('sing-box');
    if (data.engines?.xray) engines.push('xray');
    if (data.engines?.argo) engines.push('argo');
    const statEngines = document.getElementById('statEngines');
    if (statEngines) statEngines.innerText = engines.join(' + ') || 'موتور فعالی نیست';

    const unifiedUrl = data.subscriptionUrl;
    const unifiedInput = document.getElementById('urlSubUniversal');
    if (unifiedInput) unifiedInput.value = unifiedUrl || '';
    const openPage = document.getElementById('openSubscriptionPage');
    if (openPage && unifiedUrl) openPage.href = unifiedUrl;

    renderNodes(data.nodes, locationStr);

  } catch (err) {
    console.error('Failed to load gate status:', err);
    const container = document.getElementById('nodesContainer');
    if (container) {
      container.innerHTML = `
        <div class="no-nodes-msg">
          <p>دریافت اطلاعات ناموفق بود. اتصال را بررسی و صفحه را تازه‌سازی کنید.</p>
        </div>
      `;
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  handleRouting();
  loadGateData();
});

(function () {
  const $=id=>document.getElementById(id);
  const prefix='/' + (location.pathname.split('/').filter(Boolean)[0] || 'amyrax');
  const names={'VLESS-WS':'VLESS WS','VMess-WS':'VMess WS','Trojan-WS':'Trojan WS','Shadowsocks-WS':'Shadowsocks WS','VMess-HTTPUpgrade':'VMess HTTPUpgrade','Trojan-HTTPUpgrade':'Trojan HTTPUpgrade','VLESS-gRPC':'VLESS gRPC','VLESS-XHTTP':'VLESS XHTTP','VLESS-HTTPUpgrade':'VLESS HTTPUpgrade',Other:'سایر'};
  const total=e=>(e?.up||0)+(e?.down||0);
  let loading=false,lastStamp=0;
  function render(d){
    if(!d?.ok || !d.live)return;
    const stamp=Date.parse(d.now);if(stamp<lastStamp)return;lastStamp=stamp;
    amyraxTraffic(d);updateAmyraxResources(d.system);
    for(const [id,value] of Object.entries({usageLiveUp:d.live.upBps,usageLiveDown:d.live.downBps,usageDayTotal:d.day.total,usageDayUp:d.day.up,usageDayDown:d.day.down,usageMonthTotal:d.month.used,usageMonthUp:d.month.up,usageMonthDown:d.month.down,usageAllTotal:d.allTime.total,usageAllUp:d.allTime.up,usageAllDown:d.allTime.down}))amyraxValue(id,value,id.startsWith('usageLive'));
    amyraxSet('usageMonthKey','('+d.month.key+')');
    const rows=document.createDocumentFragment();
    const cell=(row,value,bytes=false)=>{const td=document.createElement('td');td.textContent=bytes?amyraxBytes(value):value;if(bytes)td.title=Number(value).toLocaleString('en-US')+' bytes';row.append(td);};
    for(const k of d.keys.filter(k=>['VLESS-WS','VMess-WS'].includes(k)||total(d.allTime.per[k])>0||d.active[k]>0)){
      const tr=document.createElement('tr'),m=d.month.per[k]||{};
      cell(tr,names[k]||k);cell(tr,d.active[k]||0);
      for(const value of [total(d.day.per[k]),m.up||0,m.down||0,total(m),total(d.allTime.per[k])])cell(tr,value,true);
      rows.append(tr);
    }
    $('usageRows').replaceChildren(rows);
    const foot=document.createElement('tr');cell(foot,'مجموع');cell(foot,d.connections?.tunnels||0);
    for(const value of [d.day.total,d.month.up,d.month.down,d.month.total,d.allTime.total])cell(foot,value,true);
    $('usageFoot').replaceChildren(foot);
    if(d.month.baseBytes){const tr=document.createElement('tr');const td=document.createElement('td');td.colSpan=5;td.textContent='تعدیل ذخیره‌شدهٔ ماه';tr.append(td);cell(tr,d.month.baseBytes,true);cell(tr,'—');$('usageFoot').append(tr);}
    const box=$('usageLimit');box.hidden=!d.limit;
    if(d.limit){
      const pct=Math.max(0,d.limit.pct);box.classList.toggle('is-warn',pct>=80);box.classList.toggle('is-over',pct>=100);
      amyraxSet('usageLimitText',amyraxBytes(d.limit.used)+' / '+amyraxBytes(d.limit.bytes));amyraxSet('usageLimitPct',pct.toFixed(1)+'%');
      $('usageBar').style.width=Math.min(100,pct)+'%';amyraxSet('usageLimitMsg','باقی‌مانده: '+amyraxBytes(d.limit.remaining));
    }
    document.querySelectorAll('[data-page="usage"]').forEach(a=>{
      let dot=a.querySelector('.usage-nav-dot');
      if(d.limit?.pct>=80){if(!dot){dot=document.createElement('span');dot.className='usage-nav-dot';a.append(dot);}dot.classList.toggle('over',d.limit.pct>=100);}else dot?.remove();
    });
    amyraxSet('trafficUpdated','به‌روز: '+new Date(d.now).toLocaleTimeString('fa-IR'));
  }
  async function load(){
    if(loading)return;loading=true;
    try{render(await amyraxRequestJson(prefix+'/api/traffic',{timeoutMs:6000}));}
    catch(_){for(const id of ['usageLiveUp','usageLiveDown','overviewUp','overviewDown'])amyraxSet(id,'—');amyraxSet('trafficUpdated','دریافت آمار ناموفق؛ اعداد قبلی به‌روز نیستند.');}
    finally{loading=false;}
  }
  const active=()=>document.visibilityState==='visible'&&($('viewHome')?.classList.contains('active')||$('viewUsage')?.classList.contains('active'));
  setInterval(()=>{if(active())load();},2000);
  window.addEventListener('hashchange',()=>{if(active())load();});
  document.addEventListener('visibilitychange',()=>{if(active())load();});
  window.addEventListener('amyrax-refresh',load);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',load);else load();
})();

(function () {
  const btn = document.getElementById('updateBtn');
  if (!btn) return;
  const API = '/' + (window.location.pathname.split('/').filter(Boolean)[0] || 'amyrax') + '/api/update';
  let info = null;
  async function call(method) {
    btn.classList.add('busy');
    try {
      return await amyraxRequestJson(API, { method, headers: { 'X-Amyrax-Req': '1' } });
    } finally { btn.classList.remove('busy'); }
  }
  async function check(quiet) {
    try {
      info = await call('GET');
      if (info.disabled) { btn.remove(); return; }
      btn.classList.toggle('has-update', !!info.newer);
      btn.title = info.newer ? 'Update to ' + info.latest + ' (you have v' + info.current + ')' : 'v' + info.current + ' - up to date, click to check again';
      btn.setAttribute('aria-label', btn.title);
      if (!quiet) showToast(info.newer ? 'New release: ' + info.latest : info.latest ? 'You are on the latest release' : 'No GitHub release published yet');
    } catch (e) { if (!quiet) showToast('Update check failed: ' + e.message); }
  }
  async function apply() {
    const how = info.mode === 'fork'
      ? 'Your GitHub fork is synced and Railway redeploys (about 1-2 minutes).'
      : 'The panel downloads it from GitHub and restarts (about 30 seconds).';
    if (!confirm('Update to ' + info.latest + '?\n' + how)) return;
    try {
      await call('POST');
    } catch (e) { showToast('Update failed: ' + e.message); return; }
    showToast('Updating to ' + info.latest + ' - the page reloads when it is back');
    btn.disabled = true;
    btn.classList.add('busy');
    const until = Date.now() + 5 * 60000;
    const poll = async () => {
      try {
        const d = await amyraxRequestJson(API);
        if (!d.newer) return location.reload();
      } catch (_) {}
      if (Date.now() < until) setTimeout(poll, 4000); else location.reload();
    };
    setTimeout(poll, 5000);
  }
  btn.addEventListener('click', () => (info && info.newer ? apply() : check(false)));
  check(true);
})();

const amyraxSet = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value; };
function amyraxBytes(value, speed = false) {
  if(value===null||value===undefined||!Number.isFinite(Number(value)))return '—';
  let n=Math.abs(Number(value)),i=0;const units=['B','KiB','MiB','GiB','TiB'];
  while(n>=1024&&i<units.length-1){n/=1024;i++;}
  return (Number(value)<0?'-':'')+n.toLocaleString('en-US',{maximumFractionDigits:i?2:0})+' '+units[i]+(speed?'/s':'');
}
function amyraxValue(id,value,speed=false){
  amyraxSet(id,amyraxBytes(value,speed));const e=document.getElementById(id);
  if(e)e.title=value!==null&&value!==undefined&&Number.isFinite(Number(value))?Number(value).toLocaleString('en-US',{maximumFractionDigits:2})+' bytes'+(speed?'/s':''):'';
}
function amyraxDuration(seconds) {
  if(seconds===null||seconds===undefined||!Number.isFinite(Number(seconds)))return '—';
  const s=Math.max(0,Math.floor(seconds)),d=Math.floor(s/86400),h=Math.floor(s%86400/3600),m=Math.floor(s%3600/60);
  return (d?d+'d ':'')+(h?h+'h ':'')+m+'m '+(s%60)+'s';
}
let amyraxResourceStamp=0;
function updateAmyraxResources(system){
  if(!system||system.sampledAt<amyraxResourceStamp)return;amyraxResourceStamp=system.sampledAt;
  const memory=system.memory||{};
  amyraxSet('overviewCores',system.cores??'—');amyraxSet('homeUptime',amyraxDuration(system.panelUptime));
  amyraxSet('systemUptime',amyraxDuration(system.uptime));amyraxSet('systemUptimeLabel',system.uptimeScope==='container'?'فعالیت محیط اجرا':'فعالیت میزبان');
  amyraxSet('memoryScope',memory.scope==='host'?'حافظهٔ میزبان':'حافظهٔ محیط اجرا');
  amyraxValue('processMemory',system.processRss);amyraxValue('memoryUsed',memory.used);
  amyraxSet('memoryTotal',memory.total?'/ '+amyraxBytes(memory.total):'سقف در دسترس نیست');
  const pct=memory.total>0&&memory.used!==null?memory.used/memory.total*100:null;
  amyraxSet('memoryPercent',pct===null?'—':pct.toFixed(0)+'%');
  document.getElementById('memoryRing')?.style.setProperty('--pct',pct===null?0:Math.min(100,Math.max(0,pct)));
}
function updateAmyraxOverview(data) {
  if (!data || !data.ok) return;
  const system = data.system || {}, memory = system.memory || {};
  const enabled = data.enabled || {}, engines = data.engines || {};
  const nodes = (data.nodes || []).filter(n => n && n.uri);
  amyraxSet('overviewHost', data.domain || data.host || '—');
  amyraxSet('serverPlatform', system.os || '—');
  amyraxSet('overviewPlatform', system.platform || '—');
  amyraxSet('homeLocation', data.location || '—');
  amyraxSet('homePort', data.publicPort || '—');
  amyraxSet('statUptime', amyraxDuration(data.uptime));
  amyraxSet('overviewNodes', nodes.length);
  updateAmyraxResources(system);
  updateAmyraxWorkQueue(data.workQueue);
  const singEnabled = Object.entries(enabled).some(([key, val]) => val && !['argo', 'vlessXhttp'].includes(key));
  [['engineSingbox', engines.singbox, singEnabled], ['engineXray', engines.xray, enabled.vlessXhttp], ['engineArgo', engines.argo, enabled.argo]].forEach(([id, running, configured]) => {
    const el = document.getElementById(id);
    if (el) { el.textContent = running ? 'در حال اجرا' : configured ? 'متوقف' : 'غیرفعال'; el.classList.toggle('running', !!running); }
  });
  const active = Object.values(engines).filter(Boolean).length;
  amyraxSet('engineCount', active + ' / 3 فعال');
  amyraxSet('statEngines', active ? Object.keys(engines).filter(key => engines[key]).join(' + ') : 'موتور فعالی نیست');
  amyraxSet('connectionLabel', active ? 'سرویس فعال' : 'پنل در دسترس');
  document.getElementById('connectionState')?.classList.remove('offline');
  document.getElementById('serverIndicator')?.style.setProperty('background', 'var(--primary-red)');
  amyraxSet('overviewUpdated', 'آخرین دریافت: ' + new Date().toLocaleTimeString('fa-IR', {hour: '2-digit', minute: '2-digit'}));
  const grouped = new Map();
  for (const node of nodes) {
    const type = String(node.type || 'OTHER').replace(/-/g, ' ').toUpperCase();
    grouped.set(type, (grouped.get(type) || 0) + 1);
  }
  const protocolGrid = document.getElementById('protocolGrid');
  if (protocolGrid) {
    protocolGrid.replaceChildren();
    for (const [name, count] of grouped) {
      const item = document.createElement('div'); item.className = 'protocol-item';
      const dot = document.createElement('span'); dot.className = 'status-dot';
      const label = document.createElement('strong'); label.textContent = name;
      const total = document.createElement('span'); total.textContent = count + ' کانفیگ';
      item.append(dot, label, total); protocolGrid.append(item);
    }
    if (!grouped.size) { const message = document.createElement('p'); message.className = 'muted'; message.textContent = 'کانفیگی در دسترس نیست.'; protocolGrid.append(message); }
  }
  amyraxSet('protocolCount', grouped.size + ' نوع اتصال');
}
function amyraxTraffic(data) {
  if(!data?.ok||!data.live)return;
  amyraxValue('overviewUp',data.live.upBps,true);amyraxValue('overviewDown',data.live.downBps,true);
  amyraxValue('overviewSent',data.day.up);amyraxValue('overviewReceived',data.day.down);amyraxValue('overviewMonth',data.month.used);
  amyraxSet('overviewConnections',data.connections?.accounts??'—');
  amyraxSet('overviewTunnels',(data.connections?.tunnels??0)+' تونل باز');
  const points=data.live.samples||[],latest=points.at(-1)?.t||Date.parse(data.now),start=latest-60000;
  const visible=points.filter(p=>p.t>=start),peak=Math.max(1,...visible.flatMap(p=>[p.upBps,p.downBps]));
  const line=key=>visible.map((p,i)=>((i===0||p.t-visible[i-1].t>3500)?'M':'L')+Math.max(0,(p.t-start)*500/60000).toFixed(1)+','+(100-p[key]/peak*90).toFixed(1)).join(' ');
  document.getElementById('chartUp')?.setAttribute('d',line('upBps'));document.getElementById('chartDown')?.setAttribute('d',line('downBps'));
  document.getElementById('chartArea')?.setAttribute('d','');
  const empty=document.getElementById('chartEmpty');if(empty)empty.hidden=visible.some(p=>p.upBps>0||p.downBps>0);
}
function amyraxPageTitle(page) {
  const pages = {
    home: ['نمای کلی پنل', 'وضعیت اتصال، سرویس‌ها و مصرف ترافیک؛ همه در یک نگاه.', 'نمای کلی'],
    subs: ['لینک‌های اشتراک', 'یک لینک برای وارد کردن همهٔ کانفیگ‌ها در برنامهٔ دلخواه شما.', 'اشتراک‌ها'],
    nodes: ['کانفیگ‌های اتصال', 'کانفیگ دلخواه را انتخاب کنید، کپی کنید یا کد QR آن را اسکن کنید.', 'کانفیگ‌ها'],
    users: ['مدیریت کاربران', 'ساخت اشتراک مستقل، تعیین حجم و زمان و پیگیری مصرف هر کاربر.', 'کاربران'],
    usage: ['مصرف ترافیک', 'مصرف امروز، این ماه و جزئیات ترافیک هر پروتکل را دنبال کنید.', 'ترافیک']
  };
  const [title, description, breadcrumb] = pages[page] || pages.home;
  amyraxSet('pageTitle', title); amyraxSet('pageDescription', description); amyraxSet('breadcrumbPage', breadcrumb);
  document.querySelectorAll('.nav-link,.mob-link').forEach(link => {
    if (link.dataset.page === page) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
  });
}
async function amyraxRefresh() {
  const button = document.getElementById('refreshOverview');
  if (button) { button.disabled = true; button.classList.add('busy'); }
  try {
    const data = await amyraxRequestJson('/health');
    updateAmyraxOverview(data);
    renderNodes(data.nodes, data.location);
  } catch (error) {
    if (error.status === 401) { window.location.assign('/' + (location.pathname.split('/').filter(Boolean)[0] || 'amyrax') + '/login'); return; }
    if (error.status === 503) { amyraxSet('overviewUpdated', 'سرور مشغول است؛ چند ثانیه بعد دوباره تلاش کنید.'); return; }
    amyraxSet('connectionLabel', 'ارتباط قطع است');
    document.getElementById('connectionState')?.classList.add('offline');
    amyraxSet('overviewUpdated', 'دریافت وضعیت ناموفق بود؛ دوباره تلاش کنید.');
  } finally { if (button) { button.disabled = false; button.classList.remove('busy'); } }
}
document.getElementById('refreshOverview')?.addEventListener('click', async () => { await amyraxRefresh(); window.dispatchEvent(new Event('amyrax-refresh')); });
document.getElementById('drawerScrim')?.addEventListener('click', () => toggleDrawer(false));
setInterval(() => { if (document.visibilityState === 'visible' && document.getElementById('viewHome')?.classList.contains('active')) amyraxRefresh(); }, 15000);

function updateAmyraxWorkQueue(data) {
  if (!data) return;
  const fa = new Intl.NumberFormat('fa-IR');
  amyraxSet('workQueueState', {normal:'فعال',busy:'کاهش ظرفیت',paused:'انتظار حافظه'}[data.pressure] || '—');
  amyraxSet('workQueueActive', fa.format(data.active) + ' / ' + fa.format(data.capacity));
  amyraxSet('workQueuePending', fa.format(data.pending) + ' / ' + fa.format(data.maxQueued));
}
let amyraxQueueLoading = false;
async function refreshAmyraxWorkQueue() {
  if (amyraxQueueLoading || document.visibilityState !== 'visible' || !document.getElementById('viewHome')?.classList.contains('active')) return;
  amyraxQueueLoading = true;
  try {
    const base = '/' + (location.pathname.split('/').filter(Boolean)[0] || 'amyrax');
    updateAmyraxWorkQueue(await amyraxRequestJson(base + '/api/work-queue',{timeoutMs:5000}));
  } catch (_) { amyraxSet('workQueueState','وضعیت در دسترس نیست'); }
  finally {amyraxQueueLoading = false;}
}
setInterval(refreshAmyraxWorkQueue,5000);
window.addEventListener('amyrax-refresh',refreshAmyraxWorkQueue);
window.addEventListener('hashchange',refreshAmyraxWorkQueue);

window.addEventListener("resize", () => toggleDrawer(false));
