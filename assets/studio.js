(() => {
  const el = (tag, cls, value) => { const e = document.createElement(tag); if (cls) e.className = cls; if (value !== undefined) e.textContent = value; return e; };
  function init(root, base) {
    if (!root || root.dataset.studioReady) return; root.dataset.studioReady = 'true';
    let data = null, editing = null, result = null, loading = false, mutating = false;
    root.classList.add('studio-shell');
    const intro = el('div', 'studio-intro'), introCopy = el('div'); introCopy.append(el('h2', '', 'کانفیگ، به سبک شما'), el('p', '', 'کانفیگ‌های خودکار آماده‌اند. اینجا یک اتصال شخصی بسازید و به همان اشتراک اضافه کنید.')); intro.append(introCopy, el('span', 'studio-badge', 'CONFIG STUDIO')); root.append(intro);
    const error = el('div', 'studio-message'); error.hidden = true; error.setAttribute('role', 'alert'); root.append(error);
    const layout = el('div', 'studio-layout'), editor = el('section', 'studio-card'), saved = el('section', 'studio-card');
    const form = el('form'), formTitle = el('h3', '', 'ساخت کانفیگ شخصی'), grid = el('div', 'studio-grid'), advanced = el('details', 'studio-advanced'), advancedGrid = el('div', 'studio-grid'); advanced.append(el('summary', '', 'تنظیمات پیشرفتهٔ اتصال'), advancedGrid);
    const fields = {}, field = (key, caption, type, parent = grid, options, help = '') => {
      const wrapper = el('label', 'studio-field' + (key === 'name' || key === 'variant' || key === 'accountId' ? ' full' : '')); wrapper.append(el('span', '', caption));
      const input = el(type === 'select' ? 'select' : 'input'); if (type !== 'select') input.type = type;
      input.id = 'admin-studio-' + key; input.name = key; input.autocomplete = 'off';
      if (type === 'select') for (const [value, name] of options || []) { const o = el('option', '', name); o.value = value; input.append(o); }
      if (['server', 'port', 'host', 'sni', 'path'].includes(key)) input.dir = 'ltr';
      if (type === 'checkbox') wrapper.classList.add('studio-check'); wrapper.append(input); if (help) wrapper.append(el('small', '', help)); parent.append(wrapper); fields[key] = input; return input;
    };
    field('accountId', 'حساب اتصال', 'select');
    field('name', 'نام کانفیگ', 'text').required = true; fields.name.maxLength = 80;
    field('variant', 'پروتکل و انتقال فعال', 'select').required = true;
    field('enabled', 'نمایش در لیست و اشتراک', 'checkbox').checked = true;
    field('server', 'آدرس اتصال (اختیاری)', 'text', advancedGrid, null, 'خالی = آدرس فعلی پنل. دامنه یا IP جایگزین باید واقعاً به همین سرور برسد.');
    field('port', 'پورت عمومی (اختیاری)', 'number', advancedGrid, null, 'خالی = پورت فعلی. پورت جدید باید از قبل در هاست به سرویس متصل باشد.'); fields.port.min = 1; fields.port.max = 65535;
    field('path', 'مسیر WS / HTTPUpgrade', 'text', advancedGrid, null, 'خالی = مسیر خودکار. مسیر دلخواه هنگام ذخیره روی همین پنل فعال می‌شود.');
    field('host', 'Host انتقال (اختیاری)', 'text', advancedGrid);
    field('sni', 'SNI (اختیاری)', 'text', advancedGrid, null, 'باید با دامنه و گواهی سرور سازگار باشد.');
    field('fingerprint', 'اثر انگشت TLS', 'select', advancedGrid, [['chrome','Chrome'],['firefox','Firefox'],['safari','Safari'],['edge','Edge'],['ios','iOS'],['android','Android'],['randomized','Randomized'],['random','Random'],['360','360'],['qq','QQ'],['','بدون اثر انگشت']]);
    const actions = el('div', 'studio-actions'), preview = el('button', 'studio-button', 'پیش‌نمایش'), save = el('button', 'studio-button primary', 'ذخیره و افزودن به ساب'), cancel = el('button', 'studio-button', 'کانفیگ جدید'); preview.type = cancel.type = 'button'; save.type = 'submit'; cancel.hidden = true; actions.append(preview, save, cancel);
    const output = el('div', 'studio-result'); output.hidden = true; const outputSelect = el('select'), text = el('textarea', 'studio-output'); outputSelect.id='admin-studio-output'; text.readOnly = true; text.setAttribute('aria-label', 'خروجی کانفیگ');
    for (const [value, caption] of [['uri','لینک اتصال'],['xrayJson','Outbound · Xray'],['singboxJson','Outbound · sing-box']]) { const o = el('option', '', caption); o.value = value; outputSelect.append(o); } outputSelect.setAttribute('aria-label', 'قالب خروجی');
    const outputActions = el('div', 'studio-actions'), copy = el('button', 'studio-button', 'کپی خروجی'), download = el('button', 'studio-button', 'دانلود خروجی'), qr = el('button', 'studio-button', 'QR'); copy.type = download.type = qr.type = 'button'; outputActions.append(copy, download, qr); output.append(el('h3', '', 'خروجی آماده'), outputSelect, text, outputActions);
    form.append(formTitle, grid, advanced, actions); editor.append(form, output); saved.append(el('h3', '', 'کانفیگ‌های شخصی شما'), el('p', '', 'هر مورد فعال با مشخصات همان حساب، کنار کانفیگ‌های خودکار به اشتراک اضافه می‌شود. خاموش‌کردن این مورد، حساب را غیرفعال نمی‌کند.')); const list = el('div', 'studio-list'); saved.append(list); layout.append(editor, saved); root.append(layout);
    async function request(suffix = '', method = 'GET', body) {
      const options = { method, cache:'no-store', credentials:'same-origin', headers:method === 'GET' ? {} : {'Content-Type':'application/json','X-Amyrax-Req':'1'}, ...(body ? {body:JSON.stringify(body)} : {}) };
      if (window.amyraxRequestJson) return amyraxRequestJson(base + suffix, {...options,timeoutMs:120000});
      const controller = new AbortController(), timer = setTimeout(()=>controller.abort(),120000);
      try { const response = await fetch(base + suffix, {...options,signal:controller.signal}); const value = await response.json(); if (!response.ok || !value.ok) throw new Error(value.error || 'دریافت اطلاعات ناموفق بود.'); return value; }
      finally { clearTimeout(timer); }
    }
    const message = (value, success = false) => { error.textContent = value; error.hidden = !value; error.classList.toggle('success', success); };
    const enhance = select => { select.dataset.panelSelect = ''; window.AmyraxControls?.enhance?.(select); window.AmyraxControls?.sync(select); };
    const sync = select => window.AmyraxControls?.sync(select);
    function collect() { return { accountId:fields.accountId.value, name:fields.name.value.trim(), variant:fields.variant.value, server:fields.server.value.trim(), port:fields.port.value ? Number(fields.port.value) : null, sni:fields.sni.value.trim(), host:fields.host.value.trim(), path:fields.path.value.trim(), fingerprint:fields.fingerprint.value, enabled:fields.enabled.checked, ...(editing ? {revision:editing.revision} : {}) }; }
    function updateOutput() { text.value = result?.[outputSelect.value] || 'این انتقال در sing-box پشتیبانی نمی‌شود؛ خروجی Xray را انتخاب کنید.'; copy.disabled = download.disabled = !result?.[outputSelect.value]; qr.hidden = outputSelect.value !== 'uri'; sync(outputSelect); }
    function showResult(value) { result = value; output.hidden = false; outputSelect.value = 'uri'; updateOutput(); }
    function edit(p = null) { editing = p; form.reset(); fields.accountId.value = data.accountId; for (const key of ['name','variant','server','sni','host','path','fingerprint']) fields[key].value = p?.[key] ?? (key === 'variant' ? data.options[0]?.value || '' : key === 'fingerprint' ? 'chrome' : ''); fields.port.value = p?.port ?? ''; fields.enabled.checked = p?.enabled ?? true; formTitle.textContent = p ? 'ویرایش ' + p.name : 'ساخت کانفیگ شخصی'; save.textContent = p ? 'ذخیرهٔ تغییرات' : 'ذخیره و افزودن به ساب'; cancel.hidden = !p; advanced.open = !!p; output.hidden = true; [fields.accountId, fields.variant, fields.fingerprint].forEach(sync); settings(); }
    function settings() { const option = data?.options.find(o=>o.value===fields.variant.value); fields.path.disabled = !['ws','httpupgrade'].includes(option?.transport); fields.sni.disabled = fields.fingerprint.disabled = !option?.tls; if(fields.path.disabled)fields.path.value=''; sync(fields.fingerprint); }
    function renderList() {
      list.replaceChildren(); for (const p of data.profiles) {
        const card = el('article', 'studio-profile'); card.append(el('h4', '', p.name), el('small', '', p.variant + ' · ' + (!p.enabled ? 'غیرفعال در ساب' : !p.node ? 'انتقال در دسترس نیست' : 'فعال در ساب')));
        const a = el('div','studio-actions'), button = (caption, handler, cls='') => { const b = el('button','studio-button '+cls,caption); b.type='button'; b.addEventListener('click',handler); a.append(b); return b; };
        button('ویرایش',()=>{edit(p);fields.name.focus();}); const exportButton=button('خروجی / Outbound',()=>showResult(p.node)); exportButton.disabled=!p.node;if(!p.node)exportButton.dataset.unavailable='true';
        button('حذف',async()=>{if(!confirm('کانفیگ «'+p.name+'» از لیست و ساب حذف شود؟ حساب اتصال حفظ می‌شود.'))return;await run(async()=>{await request('/profiles/'+p.id,'DELETE',{revision:p.revision});await load();edit();changed();message('کانفیگ از اشتراک حذف شد.',true);});},'studio-delete');
        card.append(a); list.append(card);
      } if (!data.profiles.length) list.append(el('div','studio-empty','هنوز کانفیگ شخصی نساخته‌اید. اولین مورد را با فرم کنار صفحه بسازید.'));
    }
    async function load(preserve = false) {
      if (loading) return; loading = true;
      try { data = await request('?accountId=' + encodeURIComponent(fields.accountId.value || 'shared'));
        fields.accountId.replaceChildren(); for(const a of data.accounts || [{id:data.accountId,name:'حساب شما'}]) {const o=el('option','',a.name);o.value=a.id;fields.accountId.append(o);}fields.accountId.value=data.accountId;
        const current=fields.variant.value; fields.variant.replaceChildren();for(const o of data.options){const opt=el('option','',o.value);opt.value=o.value;fields.variant.append(opt);}if(data.options.some(o=>o.value===current))fields.variant.value=current;
        for(const key of ['server','port','host','sni','path']) fields[key].placeholder=String(data.defaults[key]);
        [fields.accountId,fields.variant,fields.fingerprint,outputSelect].forEach(enhance); renderList(); if(!preserve)edit(); renderEgress(); preview.disabled=save.disabled=!data.options.length;
      } catch(e){message(e.message);} finally {loading=false;}
    }
    async function run(task) { if(mutating)return;mutating=true;root.querySelectorAll('button').forEach(b=>b.disabled=true);message('');try{await task();}catch(e){message(e.message);}finally{mutating=false;root.querySelectorAll('button').forEach(b=>b.disabled=false);updateOutput();settings();[fields.accountId,fields.variant,fields.fingerprint].forEach(sync);preview.disabled=save.disabled=!data?.options.length;list.querySelectorAll('[data-unavailable]').forEach(b=>b.disabled=true);} }
    const changed = () => { window.dispatchEvent(new Event('amyrax-configs-changed')); window.amyraxRefresh?.(); };
    preview.addEventListener('click',()=>{if(form.reportValidity())run(async()=>{showResult((await request('/preview','POST',collect())).node);message('پیش‌نمایش آماده است؛ برای فعال‌شدن مسیر و اضافه‌شدن به اشتراک، ذخیره کنید.',true);});});
    form.addEventListener('submit',e=>{e.preventDefault();run(async()=>{await request('/profiles'+(editing?'/'+editing.id:''),editing?'PATCH':'POST',collect());await load();edit();changed();message('کانفیگ ذخیره شد و در اشتراک همان حساب قرار گرفت.',true);});});
    cancel.addEventListener('click',()=>edit());fields.accountId.addEventListener('change',()=>load());fields.variant.addEventListener('change',settings);outputSelect.addEventListener('change',updateOutput);
    copy.addEventListener('click',async()=>{try{if(window.copyTextToClipboard)await copyTextToClipboard(text.value);else{await navigator.clipboard.writeText(text.value);message('خروجی کپی شد.',true);}}catch{message('کپی خودکار ممکن نشد؛ متن خروجی را انتخاب و کپی کنید.');text.select();}});
    download.addEventListener('click',()=>{const blob=new Blob([text.value],{type:outputSelect.value==='uri'?'text/plain':'application/json'}),url=URL.createObjectURL(blob),a=el('a');a.href=url;a.download='Amyrax-'+(outputSelect.value==='uri'?'config.txt':outputSelect.value==='xrayJson'?'Xray-outbound.json':'SingBox-outbounds.json');a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
    qr.addEventListener('click',()=>{window.openQr?.(result.uri,result.name);});
    let egress, egressName, egressInput, egressEnabled, egressState, apply;
    {
      egress=el('section','studio-card studio-egress');egress.append(el('h3','','اتصال خروجی پنل'),el('p','','برای عبور ترافیک VPN این پنل از سرور دیگر، لینک اتصال یا یک Outbound استاندارد Xray وارد کنید. بررسی، ساختار تنظیمات را تأیید می‌کند. اعمال تغییر، پنل را یک‌بار راه‌اندازی مجدد می‌کند و اتصال‌های فعلی لحظه‌ای قطع می‌شوند.'));
      egressState=el('p');egress.append(egressState);const egGrid=el('div','studio-grid');
      const ef=(caption,input)=>{const l=el('label','studio-field full');l.append(el('span','',caption),input);egGrid.append(l);return input;};
      egressEnabled=ef('عبور از سرور دیگر',el('input'));egressEnabled.type='checkbox';egressEnabled.parentElement.classList.add('studio-check');
      egressName=ef('نام سرور خروجی',el('input'));egressName.maxLength=80;
      egressInput=ef('لینک اتصال یا Outbound JSON',el('textarea'));egressInput.spellcheck=false;egressInput.autocomplete='off';egressInput.setAttribute('aria-label','لینک یا Outbound سرور خروجی');
      const ea=el('div','studio-actions');const egBody=()=>({enabled:egressEnabled.checked,name:egressName.value,input:egressInput.value,revision:data.revision});
      const check=el('button','studio-button','بررسی تنظیمات'),store=el('button','studio-button primary','ذخیرهٔ Outbound');apply=el('button','studio-button','اعمال و راه‌اندازی مجدد');
      check.addEventListener('click',()=>run(async()=>message((await request('/egress/check','POST',egBody())).message,true)));
      store.addEventListener('click',()=>run(async()=>{await request('/egress','POST',egBody());await load(true);message('تنظیمات ذخیره شد؛ برای اعمال روی ترافیک، راه‌اندازی مجدد را بزنید.',true);}));
      apply.addEventListener('click',()=>run(async()=>{await request('/egress/apply','POST',{});message('پنل در حال راه‌اندازی مجدد است؛ چند ثانیه بعد صفحه را تازه کنید.',true);}));
      ea.append(check,store,apply);egress.append(egGrid,ea);layout.append(egress);
    }
    function renderEgress(){if(!egress)return;const e=data.egress;egressEnabled.checked=e.enabled;egressName.value=e.name||'';egressInput.value=e.input||'';egressState.textContent='وضعیت فعلی: '+(e.active?'عبور از '+e.activeName:'اتصال مستقیم')+(e.restartRequired?' · تغییرات در انتظار اعمال':'');apply.hidden=!e.restartRequired;}
    root.addEventListener('input',e=>{if(form.contains(e.target)){output.hidden=true;result=null;}});
    function visible(){return document.visibilityState==='visible'&&document.getElementById('viewStudio')?.classList.contains('active');}
    window.addEventListener('hashchange',()=>{if(visible())load();});window.addEventListener('amyrax-refresh',()=>{if(visible())load(true);});if(visible())load();
  }
  window.AmyraxStudio={init};
  const admin=document.getElementById('studioRoot');if(admin)init(admin,'/'+(location.pathname.split('/').filter(Boolean)[0]||'amyrax')+'/api/studio');
})();
