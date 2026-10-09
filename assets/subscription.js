'use strict';
(() => {
  let data = JSON.parse(document.getElementById('subscriptionData').textContent);
  let period = 'day', qrText = '', toastTimer, renderedNodes = '', renderedChart = '';
  const $ = id => document.getElementById(id);
  const fa = new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 2 });
  const bytes = value => {
    let n = Math.max(0, Number(value) || 0), unit = 0;
    const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
    while (n >= 1024 && unit < units.length - 1) { n /= 1024; unit++; }
    return fa.format(n) + ' ' + units[unit];
  };
  const el = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text != null) node.textContent = text; return node; };
  const actionIcon = kind => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = kind === 'copy'
      ? '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>'
      : '<path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2v2h-2zM14 18h2v2h-2zM18 18h2v2h-2z"/>';
    return svg;
  };
  const toast = text => {
    clearTimeout(toastTimer);
    const dialog = document.querySelector('dialog[open]');
    if (dialog) {
      $('subscriptionToast').classList.remove('show');
      let status = dialog.querySelector('.dialog-status');
      if (!status) { status = el('p', 'dialog-status'); status.setAttribute('role', 'status'); (dialog.querySelector('.am-dialog-scroll') || dialog).append(status); }
      status.textContent = text;
      toastTimer = setTimeout(() => { status.textContent = ''; }, 2600);
    } else {
      $('subscriptionToast').textContent = text; $('subscriptionToast').classList.add('show');
      toastTimer = setTimeout(() => $('subscriptionToast').classList.remove('show'), 2600);
    }
  };
  async function copy(text) {
    if (!text) return toast('کانفیگی برای کپی وجود ندارد.');
    try {
      if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(text);
      else throw new Error('Clipboard fallback');
    } catch (_) {
      const field = el('textarea'); field.value = text; field.style.position = 'fixed'; field.style.opacity = '0';
      const active = document.activeElement;
      (document.querySelector('dialog[open]') || document.body).appendChild(field);
      field.select(); let success = false;
      try { success = document.execCommand('copy'); } catch (_) {}
      field.remove(); active?.focus();
      if (!success) return toast('کپی خودکار در این مرورگر در دسترس نیست.');
    }
    toast('کپی شد.');
  }
  function qr(text, title, showLink = false) {
    try {
      qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];
      const code = qrcode(0, 'M'); code.addData(text); code.make();
      $('qrCanvas').innerHTML = code.createSvgTag({ cellSize: 4, margin: 16, scalable: true });
      $('qrTitle').textContent = title;
      $('qrTitle').title = title;
      $('qrCanvas').setAttribute('aria-label', 'کد QR ' + title);
      $('qrValue').textContent = text;
      $('qrValue').title = text;
      $('qrLinkRow').hidden = !showLink;
      const status = $('qrDialog').querySelector('.dialog-status'); if (status) status.textContent = '';
      qrText = text; $('qrDialog').showModal();
    } catch (_) { toast('این کانفیگ برای QR طولانی است؛ از دکمهٔ کپی استفاده کنید.'); }
  }
  $('closeQr').addEventListener('click', () => $('qrDialog').close());
  $('qrDialog').addEventListener('click', e => { if (e.target === $('qrDialog')) { const r = e.target.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) e.target.close(); } });
  $('copyQrText').addEventListener('click', () => copy(qrText));
  $('copySubscription').addEventListener('click', () => copy(data.url));
  $('copyAll').addEventListener('click', () => copy(data.nodes.map(n => n.uri).filter(Boolean).join('\n')));
  $('copyManual').addEventListener('click', () => { const url = new URL(data.url); url.searchParams.delete('client'); url.searchParams.set('format', $('manualFormat').value); copy(url.href); });
  document.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', () => button.dataset.action.startsWith('qr-sub') ? qr(data.url, 'لینک اشتراک', button.dataset.action === 'qr-sub-detail') : copy(data.url)));

  function selectTab(name, focus = false) {
    for (const id of ['apps', 'configs']) {
      const active = id === name;
      $(id + 'Tab').setAttribute('aria-selected', String(active)); $(id + 'Tab').tabIndex = active ? 0 : -1;
      $(id + 'Panel').hidden = !active;
    }
    if (focus) $(name + 'Tab').focus();
  }
  for (const name of ['apps', 'configs']) {
    $(name + 'Tab').addEventListener('click', () => selectTab(name));
    $(name + 'Tab').addEventListener('keydown', event => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
        event.preventDefault(); selectTab(event.key === 'Home' ? 'apps' : event.key === 'End' ? 'configs' : name === 'apps' ? 'configs' : 'apps', true);
      }
    });
  }

  const apps = {
    v2rayn: { name: 'V2rayN', description: 'V2rayN یک کلاینت V2Ray برای ویندوز با پشتیبانی از رابط کاربری است.', download: 'https://github.com/2dust/v2rayN/releases/latest' },
    flclash: { name: 'FlClash', description: 'Flclash یک کلاینت GUI چندسکویی برای clash core است.', download: 'https://github.com/chen08209/FlClash/releases/latest' },
    v2rayng: { name: 'V2rayNG', description: 'V2rayNG یک کلاینت V2Ray برای دستگاه‌های اندرویدی است.', download: 'https://github.com/2dust/v2rayNG/releases/latest', scheme: 'v2rayng' },
    streisand: { name: 'Streisand', description: 'پشتیبانی از افزودن اشتراک در این برنامه به‌زودی فعال می‌شود.', download: 'https://apps.apple.com/app/streisand/id6450534064', scheme: 'streisand', comingSoon: true },
    singbox: { name: 'SingBox', description: 'Sing-box یک کلاینت برای مسیریابی امن ترافیک فراهم می‌کند.', download: 'https://github.com/SagerNet/sing-box/releases/latest', downloads: { ios: 'https://apps.apple.com/us/app/sing-box-mt/id6785326793', linux: 'https://github.com/SagerNet/sing-box/releases/latest' }, scheme: 'sing-box' },
    shadowrocket: { name: 'Shadowrocket', description: 'Shadowrocket یک ابزار پروکسی قانون‌محور برای iOS است.', download: 'https://apps.apple.com/app/shadowrocket/id932747118' }
  };
  const platforms = [
    { id: 'windows', title: 'Windows', apps: ['flclash', 'v2rayn'], recommended: ['flclash'] },
    { id: 'ios', title: 'iOS', apps: ['singbox', 'shadowrocket', 'streisand'], recommended: ['singbox'] },
    { id: 'android', title: 'Android', apps: ['singbox', 'flclash', 'v2rayng'], recommended: ['singbox', 'flclash'] },
    { id: 'linux', title: 'Linux', apps: ['flclash', 'singbox'], recommended: ['flclash'] }
  ];
  function platformIcon(platform) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', platform === 'ios' ? '5 3 16 17' : '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('class', platform === 'windows' || platform === 'ios' ? 'solid-platform-icon' : 'outline-platform-icon');
    const paths = {
      windows: '<path d="M4 5h7v6H4V5zm9 0h7v6h-7V5zM4 13h7v6H4v-6zm9 0h7v6h-7v-6z"/>',
      ios: '<path d="M16.9 12.1c0-1.8 1.5-2.7 1.6-2.8-.9-1.2-2.2-1.4-2.6-1.4-1.1-.1-2.1.6-2.7.6-.6 0-1.4-.6-2.3-.6-1.2 0-2.4.7-3 1.8-1.3 2.2-.3 5.5.9 7.3.6.9 1.4 1.9 2.4 1.9.9 0 1.3-.6 2.4-.6s1.4.6 2.4.6 1.7-.9 2.3-1.8c.7-1 1-2.1 1-2.1-.1 0-2.4-.9-2.4-2.9zM15.2 6.7c.5-.6.8-1.4.8-2.2-.8 0-1.6.5-2.1 1.1-.5.5-.9 1.3-.8 2.1.8.1 1.6-.4 2.1-1z"/>',
      android: '<path d="M7 10h10v7a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2v-7zM8.5 10a3.5 3.5 0 0 1 7 0M8.5 6.5 7 4.5M15.5 6.5 17 4.5M10 14h.01M14 14h.01M5 12v4M19 12v4"/>',
      linux: '<path d="M12 3c-2.4 0-4 2.1-4 5.1 0 1.5-.5 2.8-1.3 4.1L5 15.4C4.3 16.8 5.2 18 6.6 18h10.8c1.4 0 2.3-1.2 1.6-2.6l-1.7-3.2C16.5 10.9 16 9.6 16 8.1 16 5.1 14.4 3 12 3zM9 19.5 7.8 21M15 19.5l1.2 1.5M10 8h.01M14 8h.01"/>',
      chevron: '<path d="M6 9l6 6 6-6"/>'
    };
    svg.innerHTML = paths[platform];
    return svg;
  }
  function device() {
    const ua = navigator.userAgent;
    if (/android/i.test(ua)) return 'android';
    if (/iphone|ipad|ipod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ios';
    if (/windows/i.test(ua)) return 'windows';
    if (/mac/i.test(ua)) return 'macos';
    if (/linux/i.test(ua)) return 'linux';
    return '';
  }
  function appSubscriptionUrl(scheme) {
    const url = new URL(data.url, window.location.href);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Invalid subscription URL');
    url.hash = ''; url.searchParams.delete('download');
    url.searchParams.delete('client');
    url.searchParams.set('format', scheme === 'sing-box' ? 'singbox' : scheme === 'streisand' ? 'streisand' : 'base64');
    if (scheme === 'v2rayng') url.searchParams.set('client', 'v2rayng');
    return url.href;
  }
  function importUrl(scheme) {
    const target = appSubscriptionUrl(scheme), encoded = encodeURIComponent(target), name = encodeURIComponent(data.title || 'اشتراک');
    if (scheme === 'v2rayng') {
      const remark = encodeURIComponent(String(data.title || 'اشتراک').replace(/[\u0000-\u001f\u007f#]/g, ' ').trim());
      const targetUrl = target + '#' + remark;
      return 'v2rayng://install-sub?url=' + encodeURIComponent(targetUrl.replace(/%/g, '%25').replace(/\+/g, '%2B'));
    }
    if (scheme === 'sing-box') return 'sing-box://import-remote-profile?url=' + encoded + '#' + name;
    return scheme + '://import/' + target + '#' + name;
  }
  let importTimer, pendingImport = null, currentImport = null;
  function publicHttpUrl(url) {
    const u = new URL(url), host = u.hostname.toLowerCase();
    if (u.protocol !== 'http:') return false;
    if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
      const [a,b] = host.split('.').map(Number);
      if (a===0 || a===10 || a===127 || (a===169&&b===254) || (a===172&&b>=16&&b<=31) || (a===192&&b===168) || (a>=224&&a<=239)) return false;
    }
    return true;
  }
  function cancelImportFallback() { clearTimeout(importTimer); pendingImport = null; }
  function showImportHelp(key, platform, reason) {
    cancelImportFallback();
    const app = apps[key]; currentImport = { key, platform, reason };
    const url = appSubscriptionUrl(app.scheme);
    $('importTitle').textContent = 'افزودن اشتراک به ' + app.name;
    const platformName = platforms.find(p => p.id === platform)?.title || platform;
    let message = reason === 'platform'
      ? 'این دکمه برای ' + platformName + ' است. صفحه را روی همان دستگاه و با نصب ' + app.name + ' باز کنید.'
      : reason === 'http'
        ? 'نسخه‌های جدید v2rayNG افزودن خودکار اشتراک HTTP عمومی را نمی‌پذیرند. لینک زیر را کپی کنید، در «تنظیمات اشتراک» یک اشتراک بسازید و گزینهٔ «اجازهٔ آدرس ناامن / Allow insecure URL» را برای همان اشتراک فعال کنید؛ سپس اشتراک را به‌روزرسانی کنید. برای افزودن خودکار، مدیر پنل باید لینک HTTPS با گواهی معتبر تنظیم کند.'
      : reason === 'linux'
        ? 'نسخهٔ رسمی SingBox لینوکس ابزار خط فرمان است و لینک بازکردن اپ ندارد. فایل پروفایل را دانلود و با SingBox اجرا کنید.'
        : 'اگر اپ باز نشد، نصب بودن آن را بررسی کنید و صفحه را در مرورگر اصلی دستگاه، مثل Safari یا Chrome، باز کنید. می‌توانید لینک زیر را هم در بخش اشتراک‌های اپ وارد کنید.';
    if (key === 'v2rayng' && reason === 'fallback') message += ' اگر اشتراک از قبل اضافه شده، همان را به‌روزرسانی کنید؛ افزودن دوبارهٔ لینک یکسان در بعضی نسخه‌های اپ خطا می‌دهد.';
    const host = new URL(url).hostname;
    if (host === 'localhost' || host === '[::1]' || /^127\./.test(host)) message += ' این آدرس محلی فقط روی همین کامپیوتر کار می‌کند؛ روی گوشی از دامنهٔ عمومی پنل استفاده کنید.';
    $('importHelp').textContent = message;
    $('importLink').value = url;
    const download = new URL(url); download.searchParams.set('download', '1');
    $('importDownload').href = download.href;
    $('importDownload').download = app.scheme === 'sing-box' ? 'Amyrax-SingBox.json' : 'AmyraxPanel.txt';
    $('importCommand').hidden = reason !== 'linux';
    if (!$('importDialog').open) $('importDialog').showModal();
  }
  function handleImport(event, key, platform) {
    cancelImportFallback();
    if (apps[key].comingSoon) { event.preventDefault(); return; }
    const detected = device();
    if (detected && detected !== platform) {
      event.preventDefault(); showImportHelp(key, platform, 'platform'); return;
    }
    if (platform === 'linux') {
      event.preventDefault(); showImportHelp(key, platform, 'linux'); return;
    }
    if (key === 'v2rayng' && publicHttpUrl(appSubscriptionUrl('v2rayng'))) {
      event.preventDefault(); showImportHelp(key, platform, 'http'); return;
    }
    event.currentTarget.href = importUrl(apps[key].scheme);
    pendingImport = { key, platform };
    importTimer = setTimeout(() => {
      const pending = pendingImport;
      if (pending && document.visibilityState === 'visible') showImportHelp(pending.key, pending.platform, 'fallback');
    }, 1800);
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') cancelImportFallback(); });
  window.addEventListener('pagehide', cancelImportFallback);
  $('closeImport').addEventListener('click', () => $('importDialog').close());
  $('importDialog').addEventListener('close', () => { currentImport = null; cancelImportFallback(); });
  $('copyImportLink').addEventListener('click', () => { if (currentImport) copy(appSubscriptionUrl(apps[currentImport.key].scheme)); });
  function renderApps() {
    const detected = device();
    const ordered = [...platforms].sort((a, b) => Number(b.id === detected) - Number(a.id === detected));
    for (const [index, platform] of ordered.entries()) {
      const details = el('details', 'platform'); details.dataset.os = platform.id; details.setAttribute('name', 'client-platform'); details.open = index === 0;
      details.classList.toggle('current', platform.id === detected);
      const summary = el('summary');
      const osIcon = el('span', 'platform-icon'); osIcon.append(platformIcon(platform.id)); summary.append(osIcon);
      const heading = el('span', 'platform-main');
      const titleRow = el('span', 'platform-title-row'); titleRow.append(el('strong', 'platform-title', platform.title));
      if (platform.id === detected) titleRow.append(el('span', 'platform-current', 'سیستم عامل شما'));
      heading.append(titleRow, el('small', 'platform-count', fa.format(platform.apps.length) + ' اپلیکیشن')); summary.append(heading);
      const chevron = el('span', 'platform-chevron'); chevron.append(platformIcon('chevron')); summary.append(chevron); details.append(summary);
      summary.addEventListener('click', () => {
        if (!details.open) for (const other of $('appPlatforms').querySelectorAll('details')) if (other !== details) other.open = false;
      });
      const appGrid = el('div', 'platform-apps');
      for (const key of platform.apps) {
        const app = apps[key], card = el('article', 'app-card');
        card.dataset.app = key;
        card.classList.toggle('coming-soon', !!app.comingSoon);
        const top = el('div', 'app-top');
        const icon = el('span', 'app-monogram has-app-icon'); icon.setAttribute('aria-hidden', 'true'); icon.dataset.app = key;
        const info = el('div', 'app-info'), head = el('div', 'app-head'), title = el('div', 'app-title-line');
        title.append(el('h3', 'app-name', app.name));
        if (app.comingSoon) {
          const status = el('span', 'app-tag coming-soon-tag', 'Coming soon'); status.dir = 'ltr'; title.append(status);
        } else if (platform.recommended.includes(key)) title.append(el('span', 'app-tag recommended-tag', 'پیشنهادی'));
        const tag = el('span', 'app-tag os-tag', platform.id); tag.dir = 'ltr';
        head.append(title, tag); info.append(head, el('p', 'app-description', app.description)); top.append(icon, info); card.append(top);
        const buttons = el('div', 'app-buttons');
        const download = el(app.comingSoon ? 'button' : 'a', 'download-button', 'دانلود');
        if (app.comingSoon) { download.type = 'button'; download.disabled = true; }
        else { download.href = app.downloads?.[platform.id] || app.download; download.target = '_blank'; download.rel = 'noopener noreferrer'; }
        download.setAttribute('aria-label', 'دانلود ' + app.name); buttons.append(download);
        if (app.scheme) {
          const add = el(app.comingSoon ? 'button' : 'a', 'import-button', 'افزودن اشتراک'); add.setAttribute('aria-label', 'افزودن اشتراک به ' + app.name);
          if (app.comingSoon) { add.type = 'button'; add.disabled = true; }
          else {
            add.href = importUrl(app.scheme); add.dataset.importApp = key;
            add.addEventListener('click', event => handleImport(event, key, platform.id));
          }
          buttons.append(add);
        }
        card.append(buttons);
        appGrid.append(card);
      }
      details.append(appGrid);
      $('appPlatforms').append(details);
    }
  }
  function renderNodes() {
    const query = $('configSearch').value.trim().toLowerCase();
    const nodes = data.nodes.filter(n => (n.name + ' ' + n.type).toLowerCase().includes(query));
    $('configList').replaceChildren();
    for (const node of nodes) {
      const row = el('article', 'config-node');
      const type = String(node.type || '').split('-')[0];
      const icon = el('span', 'square-icon'); icon.setAttribute('aria-hidden', 'true');
      const globe = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      globe.setAttribute('viewBox', '0 0 24 24');
      globe.innerHTML = '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.3 2.5 3.5 5.5 3.5 9S14.3 18.5 12 21M12 3C9.7 5.5 8.5 8.5 8.5 12S9.7 18.5 12 21"/>';
      icon.append(globe); row.append(icon);
      const content = el('div', 'action-copy');
      const preview = el('p', 'node-uri', type + ' · ' + node.uri); preview.dir = 'ltr';
      content.append(el('h3', '', node.name), preview);
      row.append(content);
      const qrButton = el('button', 'action-icon-button'); qrButton.append(actionIcon('qr')); qrButton.type = 'button'; qrButton.setAttribute('aria-label', 'کد QR ' + node.name); qrButton.title = 'نمایش کد QR'; qrButton.addEventListener('click', () => qr(node.uri, node.name));
      const copyButton = el('button', 'action-icon-button'); copyButton.append(actionIcon('copy')); copyButton.type = 'button'; copyButton.setAttribute('aria-label', 'کپی ' + node.name); copyButton.title = 'کپی کانفیگ'; copyButton.addEventListener('click', () => copy(node.uri));
      const actions = el('span', 'row-actions'); actions.append(qrButton, copyButton); row.append(actions);
      if (node.wgConf) {
        const wgCopy = el('button', 'soft-button wg-copy', 'کپی فایل WireGuard'); wgCopy.type = 'button'; wgCopy.addEventListener('click', () => copy(node.wgConf)); content.append(wgCopy);
      }
      $('configList').append(row);
    }
    if (!nodes.length) $('configList').append(el('p', 'empty', query ? 'کانفیگی با این مشخصات پیدا نشد.' : 'هنوز کانفیگی در دسترس نیست.'));
  }
  $('configSearch').addEventListener('input', renderNodes);

  function usageBuckets(history, updatedAt, period) {
    const now = new Date(updatedAt).getTime(), timeZone = 'Asia/Tehran';
    if (!Number.isFinite(now)) return { buckets: [], total: 0, approximate: false, timeZone };
    const calendar = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23' });
    const parts = Object.fromEntries(calendar.formatToParts(now).filter(p => p.type !== 'literal').map(p => [p.type, Number(p.value)]));
    const offset = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - Math.floor(now / 1000) * 1000;
    const midnight = Date.UTC(parts.year, parts.month - 1, parts.day) - offset;
    const step = period === 'day' ? 6 * 3600000 : 86400000;
    const count = period === 'day' ? 4 : 7;
    const start = midnight - (period === 'day' ? 0 : 6 * 86400000), since = history ? new Date(history.since).getTime() : Infinity;
    const buckets = Array.from({ length: count }, (_, i) => ({ start: start + i * step, end: start + (i + 1) * step, total: 0, observed: start + i * step <= now && since < start + (i + 1) * step, approximate: false }));
    for (const [key, value] of Object.entries(history?.hours || {})) {
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}(:\d{2})?$/.test(key)) continue;
      const at = Date.parse(key + (key.length === 13 ? ':00:00.000Z' : ':00.000Z'));
      if (!Number.isFinite(at) || at > now || !value || !Number.isSafeInteger(value.up) || !Number.isSafeInteger(value.down) || value.up < 0 || value.down < 0) continue;
      const amount = value.up + value.down;
      if (!Number.isSafeInteger(amount) || !amount) continue;
      const duration = (value.spanMinutes === 30 ? 30 : 60) * 60000;
      const overlaps = buckets.filter(b => b.start <= now && at < b.end && at + duration > b.start);
      if (!overlaps.length) continue;
      const target = overlaps.find(b => at >= b.start) || overlaps[0];
      target.total += amount; target.observed = true;
      if (overlaps.length > 1 || at < target.start || at + duration > target.end) {
        for (const bucket of overlaps) { bucket.approximate = true; bucket.observed = true; }
      }
    }
    return { buckets, total: buckets.reduce((sum, b) => sum + b.total, 0), approximate: buckets.some(b => b.approximate), timeZone };
  }
  function renderChart() {
    const chart = usageBuckets(data.traffic?.history, data.updatedAt, period), { buckets, timeZone } = chart;
    const signature = period + JSON.stringify(chart);
    if (signature === renderedChart) return;
    renderedChart = signature;
    const peak = Math.max(1, ...buckets.map(b => b.total));
    $('chartTotal').textContent = buckets.some(b => b.observed) ? (chart.approximate ? '≈ ' : '') + bytes(chart.total) : '—';
    $('usageChart').dataset.period = period;
    $('usageChart').replaceChildren();
    const descriptions = [];
    for (const bucket of buckets) {
      const date = new Date(bucket.start);
      const time = at => new Date(at).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone });
      const endTime = bucket.end === buckets.at(-1).end && period === 'day' ? '۲۴:۰۰' : time(bucket.end);
      const shortDay = ['ی', 'د', 'س', 'چ', 'پ', 'ج', 'ش'][new Date(bucket.start + 12 * 3600000).getUTCDay()];
      const label = period === 'day' ? time(bucket.start) + '\nتا ' + endTime : shortDay + '\n' + date.toLocaleDateString('fa-IR', { month: 'numeric', day: 'numeric', timeZone });
      const range = period === 'day' ? label.replace('\n', ' ') : date.toLocaleDateString('fa-IR', { weekday: 'long', month: 'long', day: 'numeric', timeZone });
      const description = range + ' (تهران): ' + (bucket.observed ? (bucket.approximate ? '≈ ' : '') + bytes(bucket.total) : 'بازه شروع نشده یا سابقه‌ای ثبت نشده') + (bucket.approximate ? '؛ مرز مصرف در سابقهٔ ساعتی قدیمی دقیق نیست.' : '');
      descriptions.push(description);
      const column = el('div', 'chart-column' + (bucket.observed ? '' : ' missing')); column.title = description;
      const slot = el('div', 'bar-slot');
      if (bucket.total > 0) { const fill = el('span', 'bar-fill'); fill.style.height = Math.max(4, bucket.total / peak * 100) + '%'; slot.append(fill); }
      const value = bucket.observed ? (bucket.approximate ? '≈ ' : '') + bytes(bucket.total) : '—';
      slot.append(el('span', 'bar-value', value));
      column.append(slot, el('span', 'bar-label', label)); $('usageChart').append(column);
    }
    $('usageChart').setAttribute('aria-label', descriptions.join('؛ '));
    $('chartCaption').textContent = (period === 'day' ? 'مصرف امروز' : 'مصرف ۷ روز، شامل امروز') + ' به ساعت تهران؛ مجموع ارسال و دریافت.' + (chart.approximate ? ' ≈ یعنی مرز بازه در سابقهٔ ساعتی قدیمی تقریبی است.' : '');
  }
  document.querySelectorAll('[data-period]').forEach(button => button.addEventListener('click', () => {
    period = button.dataset.period;
    document.querySelectorAll('[data-period]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
    renderChart();
  }));
  function render() {
    $('subscriptionTitle').textContent = data.title || 'Amyrax Panel';
    $('subscriptionTitle').dir = 'auto';
    $('subscriptionTitle').classList.toggle('account-title',!!data.account);
    $('accountDetails').hidden = !data.account;
    if (data.account) {
      const labels={active:'فعال',pending:'در انتظار اولین اتصال',disabled:'غیرفعال',expired:'اعتبار پایان یافته',limited:'حجم پایان یافته'};
      $('accountStatus').textContent=labels[data.account.status] || data.account.status;
      $('accountExpiry').textContent=data.account.expiresAt ? 'پایان اعتبار: '+new Date(data.account.expiresAt).toLocaleString('fa-IR',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Tehran'}) : data.account.durationDays ? fa.format(data.account.durationDays)+' روز از اولین اتصال' : 'زمان نامحدود';
      document.querySelector('.metrics>div:first-child>span').textContent='مصرف سهمیهٔ کاربر';
      document.querySelector('.metrics>div:nth-child(2)>span').textContent='حجم باقی‌مانده';
      document.querySelector('.summary-card .fine-print').textContent='مجموع ارسال و دریافت این کاربر؛ بدون محدودیت تعداد اتصال.';
    }
    $('monthUsage').textContent = data.traffic ? bytes(data.traffic.month) : 'در دسترس نیست';
    $('remainingUsage').textContent = data.traffic?.limit?.bytes ? bytes(data.traffic.limit.remaining) : data.account ? 'نامحدود' : 'تعیین نشده';
    $('nodeCount').textContent = fa.format(data.nodes.length) + ' کانفیگ';
    $('lastUpdate').textContent = new Date(data.updatedAt).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tehran' });
    $('lastUpdate').title = 'ساعت تهران';
    $('subscriptionHost').textContent = new URL(data.url).host;
    $('shortSubLink').textContent = data.url;
    document.querySelectorAll('[data-import-app]').forEach(a => { a.href = importUrl(apps[a.dataset.importApp].scheme); });
    if (currentImport) showImportHelp(currentImport.key, currentImport.platform, currentImport.reason);
    $('configBadge').textContent = fa.format(data.nodes.length);
    $('copyAllCount').textContent = data.nodes.length + ' مورد';
    $('copyAll').disabled = !data.nodes.length;
    $('usageTrack').hidden = !data.traffic?.limit?.bytes;
    if (data.traffic?.limit?.bytes) $('usageProgress').style.width = Math.min(100, Math.max(0, data.traffic.month/data.traffic.limit.bytes*100)) + '%';
    const nodesJson = JSON.stringify(data.nodes);
    if (nodesJson !== renderedNodes) { renderedNodes = nodesJson; renderNodes(); }
    renderChart();
  }
  let refreshing = false, refreshTimer, refreshController, failedRefreshes = 0, refreshAfterResume = false;
  const canRefresh = () => document.visibilityState === 'visible' && navigator.onLine !== false;
  function connectionStatus(message = '') {
    $('connectionStatus').textContent = message; $('connectionStatus').hidden = !message;
  }
  function scheduleRefresh(delay) {
    clearTimeout(refreshTimer);
    if (canRefresh()) refreshTimer = setTimeout(() => refresh(),delay);
  }
  async function refresh(manual = false) {
    if (refreshing) return;
    clearTimeout(refreshTimer);
    if (navigator.onLine === false) { connectionStatus('اینترنت قطع است؛ اطلاعات آخرین دریافت نمایش داده می‌شود.'); return; }
    if (!manual && !canRefresh()) return;
    refreshing = true; $('refreshSubscription').disabled = true; $('refreshSubscription').classList.add('spinning');
    const controller = new AbortController(); refreshController = controller;
    const timeout = setTimeout(() => controller.abort(), 15000);
    let retryDelay = 30000;
    try {
      const url = new URL(window.location.href); url.searchParams.set('format', 'info'); url.hash = '';
      const response = await fetch(url, { cache: 'no-store', signal: controller.signal });
      const retryAfter = response.headers.get('Retry-After');
      if (retryAfter) {
        const delay = /^\d+$/.test(retryAfter) ? Number(retryAfter)*1000 : Date.parse(retryAfter)-Date.now();
        if (Number.isFinite(delay)) retryDelay = Math.min(300000,Math.max(30000,delay));
      }
      if (!response.ok) throw new Error('Subscription unavailable');
      const updated = await response.json();
      if (!Array.isArray(updated.nodes)) throw new Error('Invalid response');
      if (controller.signal.aborted) return;
      data = updated; failedRefreshes = 0; connectionStatus(); render();
      if (manual) toast('اطلاعات به‌روز شد.');
    } catch (_) {
      if (canRefresh()) {
        failedRefreshes = Math.min(4,failedRefreshes+1);
        retryDelay = Math.max(retryDelay,Math.min(300000,30000*2**failedRefreshes));
        connectionStatus('اطلاعات به‌روز نشد؛ آخرین دریافت نمایش داده می‌شود. دوباره تلاش می‌کنیم.');
        if (manual) toast('دریافت اطلاعات ناموفق بود؛ دوباره تلاش کنید.');
      }
    } finally {
      clearTimeout(timeout); refreshing = false; refreshController = null;
      $('refreshSubscription').disabled = false; $('refreshSubscription').classList.remove('spinning');
      scheduleRefresh(refreshAfterResume ? 500 : retryDelay); refreshAfterResume = false;
    }
  }
  $('refreshSubscription').addEventListener('click', () => refresh(true));
  function resumeRefresh() {
    if (!canRefresh()) return;
    if (refreshing) refreshAfterResume = true;
    else scheduleRefresh(500);
  }
  function pauseRefresh() { clearTimeout(refreshTimer); refreshController?.abort(); }
  document.addEventListener('visibilitychange', () => { if (canRefresh()) resumeRefresh(); else pauseRefresh(); });
  window.addEventListener('offline', () => { pauseRefresh(); connectionStatus('اینترنت قطع است؛ اطلاعات آخرین دریافت نمایش داده می‌شود.'); });
  window.addEventListener('online',resumeRefresh);
  window.addEventListener('pagehide',pauseRefresh);
  window.addEventListener('pageshow',event => { if (event.persisted) resumeRefresh(); });
  renderApps(); render();
  if (navigator.onLine === false) connectionStatus('اینترنت قطع است؛ اطلاعات آخرین دریافت نمایش داده می‌شود.');
  scheduleRefresh(30000);
})();
