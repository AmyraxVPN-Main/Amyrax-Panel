(() => {
  const button = document.getElementById('updateBtn'), banner = document.getElementById('updateNotice'), dialog = document.getElementById('updateDialog');
  if (!button || !banner || !dialog) return;
  const api = '/' + (location.pathname.split('/').filter(Boolean)[0] || 'amyrax') + '/api/update';
  const title = document.getElementById('updateNoticeTitle'), summary = document.getElementById('updateNoticeSummary');
  const action = document.getElementById('installUpdate'), checkButton = document.getElementById('checkUpdate');
  const status = document.getElementById('updateDialogStatus'), releaseLink = document.getElementById('updateReleaseLink');
  const phases = {
    downloading:'در حال دریافت و بررسی فایل نصب…', installing:'در حال آماده‌کردن نسخهٔ جدید؛ پنل فعلی همچنان فعال است…',
    restarting:'نسخه آماده شد؛ پنل در حال راه‌اندازی مجدد است…', testing:'در حال بررسی اجرای نسخهٔ جدید…',
    complete:'به‌روزرسانی با موفقیت انجام شد.', failed:'به‌روزرسانی انجام نشد؛ نسخهٔ فعلی حفظ شد.',
    'rolled-back':'نسخهٔ جدید آماده نشد؛ نسخهٔ قبلی بازیابی شد.'
  };
  const busy = phase => ['downloading','installing','restarting','testing'].includes(phase);
  let info = null, request = null, applying = false, monitoring = false, timer = null, dismissed = '', announced = '', target = '', until = 0, uiError = '';
  const write = (node, value) => { node.textContent = value; };
  try { dismissed = localStorage.getItem('amyrax-update-dismissed') || ''; } catch {}
  function render() {
    if (!info) return;
    const phase = info.operation?.phase || 'idle', inProgress = busy(phase) || applying;
    button.classList.toggle('has-update', info.newer); button.classList.toggle('busy', inProgress);
    button.setAttribute('aria-label', info.newer ? 'نسخهٔ '+info.latest+' آمادهٔ به‌روزرسانی است' : 'وضعیت به‌روزرسانی پنل');
    button.title = button.getAttribute('aria-label');
    const rollback = phase === 'rolled-back' || (phase === 'complete' && !!info.rollback), failed = phase === 'failed';
    const noticeKey = rollback ? 'rolled-back:'+info.rollback?.at : failed ? phase+':'+info.operation.updatedAt : info.latest;
    banner.hidden = !(inProgress || ((rollback || failed || info.newer) && dismissed !== noticeKey));
    write(title, inProgress ? 'پنل در حال به‌روزرسانی است' : rollback ? 'نسخهٔ قبلی بازیابی شد' : failed ? 'به‌روزرسانی کامل نشد' : 'نسخهٔ '+info.latest+' منتشر شد');
    write(summary, inProgress ? phases[phase] || 'در حال آماده‌سازی…' : rollback || failed ? info.rollback?.message || info.operation.error || phases[phase] : 'نسخهٔ جدید Amyrax آماده است؛ می‌توانید همین‌جا پنل را به‌روزرسانی کنید.');
    banner.dataset.state = rollback || failed ? 'error' : inProgress ? 'busy' : 'available';
    write(document.getElementById('updateCurrentVersion'), info.current);
    write(document.getElementById('updateLatestVersion'), info.latest || 'هنوز بررسی نشده');
    let text = inProgress ? phases[phase] || 'در حال شروع به‌روزرسانی…' : rollback || failed ? info.rollback?.message || info.operation.error || phases[phase]
      : info.reason || (info.newer ? 'با زدن دکمه، نسخهٔ جدید دریافت می‌شود. اتصال‌های جاری هنگام راه‌اندازی مجدد موقتاً قطع می‌شوند.' : info.disabled ? 'بررسی خودکار با تنظیمات سرور خاموش شده است.' : info.latest ? 'پنل شما به‌روز است.' : 'هنوز نسخهٔ جدیدی دریافت نشده است.');
    if (info.checkError && !inProgress) text += ' '+info.checkError;
    if (uiError && !inProgress) text += ' '+uiError;
    write(status, text); status.dataset.state = rollback || failed || info.checkError ? 'error' : 'normal';
    action.disabled = inProgress || !info.canApply;
    write(action, inProgress ? 'در حال به‌روزرسانی…' : info.latest ? 'به‌روزرسانی به '+info.latest : 'به‌روزرسانی پنل');
    checkButton.disabled = inProgress || !!request || info.disabled;
    document.getElementById('dismissUpdateNotice').disabled = inProgress;
    if (info.url && /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/releases(?:\/tag\/v?\d+\.\d+\.\d+)?$/.test(info.url)) releaseLink.href = info.url;
    const checked = info.checkedAt ? new Date(info.checkedAt).toLocaleString('fa-IR', { timeZone:'Asia/Tehran', month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' }) : 'هنوز انجام نشده';
    write(document.getElementById('updateCheckedAt'), 'آخرین بررسی: '+checked);
    if (info.newer && announced !== info.latest && !info.checkError) { announced = info.latest; showToast('نسخهٔ '+info.latest+' پنل منتشر شده است.'); }
  }
  async function refresh(fresh = false) {
    if (request) return request;
    request = (async () => {
      try {
        const next = await amyraxRequestJson(api+(fresh?'/check':''), { method:fresh?'POST':'GET', headers:fresh?{'X-Amyrax-Req':'1'}:{}, timeoutMs:20000 });
        info = next; uiError = '';
        if (busy(info.operation?.phase) && !monitoring) { monitoring = true; target = info.operation.version; until = Date.now()+8*60000; }
        if (monitoring && info.rollback) monitoring = false;
        if (monitoring && info.current === target && info.operation?.phase === 'complete') { monitoring = false; location.reload(); return; }
        if (monitoring && ['failed','rolled-back'].includes(info.operation?.phase)) monitoring = false;
        if (monitoring && Date.now() > until) { monitoring = false; uiError = 'راه‌اندازی بیش از حد معمول طول کشید؛ وضعیت را دوباره بررسی کنید.'; }
      } catch (error) {
        if (error.status === 401) { monitoring = false; uiError = 'نشست مدیریت پایان یافته؛ دوباره وارد پنل شوید.'; }
        else if (!monitoring) { uiError = error.message; write(status, uiError); if (fresh) showToast(error.message); }
      } finally { request = null; render(); schedule(); }
    })();
    render(); return request;
  }
  function schedule() {
    clearTimeout(timer);
    if (document.hidden || !navigator.onLine) return;
    timer = setTimeout(()=>refresh(), monitoring ? 3000 : 60000);
  }
  function open() { if (!dialog.open) dialog.showModal(); render(); if (!info) refresh(); }
  async function apply() {
    if (applying || !info?.canApply) return;
    applying = true; target = info.latest; render();
    try {
      info = await amyraxRequestJson(api, { method:'POST', headers:{'X-Amyrax-Req':'1','Content-Type':'application/json'}, body:JSON.stringify({version:target}), timeoutMs:25000 });
      monitoring = true; until = Date.now()+8*60000;
    } catch (error) {
      // A lost response does not imply that the operation failed. Read the server state before retrying.
      write(status, error.message); await refresh();
      if (!monitoring) { uiError = error.message; showToast(error.message); }
    } finally { applying = false; render(); schedule(); }
  }
  button.addEventListener('click', open);
  document.getElementById('openUpdateDialog').addEventListener('click', open);
  document.getElementById('closeUpdateDialog').addEventListener('click', ()=>dialog.close());
  action.addEventListener('click', apply); checkButton.addEventListener('click', ()=>refresh(true));
  document.getElementById('dismissUpdateNotice').addEventListener('click', ()=>{
    if (busy(info?.operation?.phase)) return;
    dismissed = info?.rollback ? 'rolled-back:'+info.rollback.at : info?.operation?.phase === 'failed' ? 'failed:'+info.operation.updatedAt : info?.latest || '';
    try { localStorage.setItem('amyrax-update-dismissed', dismissed); } catch {}
    render();
  });
  document.addEventListener('visibilitychange', ()=>{ if (!document.hidden) refresh(); else clearTimeout(timer); });
  window.addEventListener('online', ()=>refresh()); window.addEventListener('offline', ()=>clearTimeout(timer));
  window.addEventListener('pageshow', schedule); window.addEventListener('pagehide', ()=>clearTimeout(timer));
  refresh();
})();
