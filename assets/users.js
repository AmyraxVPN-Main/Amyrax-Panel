(() => {
  const $=id=>document.getElementById(id), base='/' + (location.pathname.split('/').filter(Boolean)[0] || 'amyrax') + '/api/users';
  const statuses={active:'فعال',pending:'در انتظار اولین اتصال',disabled:'غیرفعال',expired:'منقضی',limited:'حجم تمام‌شده',archived:'بایگانی'};
  const fa=new Intl.NumberFormat('fa-IR');let users=[],editing=null,busy=false,currentAction=null;
  const node=(tag,cls,value)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(value!==undefined)e.textContent=value;return e;};
  const bytes=n=>amyraxBytes(n);
  const date=n=>n?new Date(n).toLocaleString('fa-IR',{dateStyle:'medium',timeStyle:'short'}):'—';
  async function api(path='',method='GET',body){
    const data=await amyraxRequestJson(base+path,{method,headers:method==='GET'?{}:{'Content-Type':'application/json','X-Amyrax-Req':'1'},...(body?{body:JSON.stringify(body)}:{})});
    if(!data.ok)throw new Error(data.error||'دریافت اطلاعات ناموفق بود.');return data;
  }
  function render(){
    const shown=users.filter(u=>{
      const q=$('userSearch').value.trim().toLowerCase(),filter=$('userStatusFilter').value;
      return (u.name.toLowerCase().includes(q)||u.note.toLowerCase().includes(q))&&(filter==='all'?u.status!=='archived':u.status===filter);
    });
    $('userTotal').textContent=fa.format(users.filter(u=>!u.archivedAt).length);
    $('userActive').textContent=fa.format(users.filter(u=>['active','pending'].includes(u.status)).length);
    $('userLimited').textContent=fa.format(users.filter(u=>['expired','limited'].includes(u.status)).length);
    AmyraxControls.close();
    $('usersList').replaceChildren();
    for(const u of shown){
      const card=node('article','user-card');const head=node('div','user-card-head');const name=node('div','user-name');
      const identity=node('div','user-identity-meta');identity.append(node('span','user-status user-status-'+u.status,statuses[u.status]),node('small','',date(u.createdAt)));name.append(node('h3','',u.name),identity);
      const headActions=node('div','user-head-actions');
      head.append(name,headActions);card.append(head);
      if(u.note)card.append(node('p','user-note',u.note));
      const metrics=node('dl','user-metrics');
      for(const [label,value] of [['مصرف / حجم',bytes(u.usedBytes)+' / '+(u.limitGB?fa.format(u.limitGB)+' GiB':'نامحدود')],['پایان اعتبار',u.expiresAt?date(u.expiresAt):u.durationDays?'پس از اولین اتصال':'نامحدود']]){const m=node('div');m.append(node('dt','',label),node('dd','',value));metrics.append(m);}card.append(metrics);
      const progress=node('div','user-progress');progress.setAttribute('aria-label','مصرف سهمیه');const fill=node('span');fill.style.width=(u.limitBytes?Math.min(100,u.usedBytes/u.limitBytes*100):0)+'%';progress.append(fill);card.append(progress);
      const meta=node('div','user-card-meta'),protocols=node('div','user-protocols');u.protocols.forEach(p=>protocols.append(node('span','',p.toUpperCase())));meta.append(protocols,node('span','user-connections',fa.format(u.activeConnections)+' اتصال باز'));card.append(meta);
      const buttons=node('div','user-card-buttons');
      const button=(label,action)=>{const b=node('button','button secondary',label);b.type='button';b.addEventListener('click',action);return b;};
      buttons.append(button('ویرایش',()=>openEditor(u)),button('کپی ساب',()=>copyTextToClipboard(u.subscriptionUrl)),button('QR',()=>openQr(u.subscriptionUrl,u.name)));
      const link=node('a','button secondary','صفحهٔ اشتراک ↗');link.href=u.subscriptionUrl;link.target='_blank';link.rel='noopener noreferrer';buttons.append(link);card.append(buttons);
      const actions=AmyraxControls.menu({label:'عملیات بیشتر',ariaLabel:'عملیات '+u.name,className:'user-actions',
        options:()=>[['toggle',u.enabled?'غیرفعال کردن':'فعال کردن'],['renew','تمدید اعتبار'],['reset','بازنشانی مصرف'],['disconnect','قطع اتصال‌های فعلی'],['rotate-link','تعویض لینک ساب'],['rotate-credentials','تعویض مشخصات اتصال'],[u.archivedAt?'restore':'archive',u.archivedAt?'بازیابی کاربر':'بایگانی کاربر'],['delete','حذف دائمی کاربر']].map(([value,label])=>({value,label,danger:value==='delete'})),
        onSelect:action=>openAction(u,action)});
      headActions.append(actions);$('usersList').append(card);
    }
    if(!shown.length)$('usersList').append(node('div','users-empty',users.length?'کاربری با این فیلتر پیدا نشد.':'اولین کاربر را بسازید؛ حجم و زمان صفر یعنی نامحدود.'));
    $('usersResultCount').textContent=fa.format(shown.length)+' کاربر';
  }
  async function load(preserveInteraction=false){
    if(busy)return;busy=true;
    try{const d=await api();users=d.items;if(!preserveInteraction||(!AmyraxControls.isOpen()&&!document.activeElement?.closest('.user-actions')))render();$('usersError').hidden=true;$('usersEngine').textContent=d.storageError?'ذخیرهٔ مصرف ناموفق است؛ اتصال کاربران تا رفع مشکل متوقف شده.':d.engine.message;$('usersEngine').dataset.status=d.storageError?'error':d.engine.status;}
    catch(e){$('usersError').textContent=e.message;$('usersError').hidden=false;}
    finally{busy=false;}
  }
  function openEditor(u=null){
    editing=u;$('userForm').reset();$('userFormError').hidden=true;$('userDialogTitle').textContent=u?'ویرایش '+u.name:'ساخت کاربر جدید';
    for(const key of ['name','note','limitGB','durationDays','resetDays','startMode'])$('user_'+key).value=u?.[key]??({limitGB:0,durationDays:0,resetDays:0,startMode:'now'}[key]??'');
    AmyraxControls.sync($('user_startMode'));
    $('user_enabled').checked=u?.enabled??true;
    document.querySelectorAll('[name="userProtocol"]').forEach(e=>e.checked=u?u.protocols.includes(e.value):true);
    $('userCurrentExpiry').textContent=u?'اعتبار فعلی: '+(u.expiresAt?date(u.expiresAt):u.durationDays?'در انتظار اولین اتصال':'نامحدود'):'';
    $('userDialog').showModal();$('user_name').focus();
  }
  $('userForm').addEventListener('submit',async e=>{
    e.preventDefault();const b=$('saveUser');if(b.disabled)return;b.disabled=true;const label=b.textContent;b.textContent='در حال پردازش…';$('userFormError').hidden=true;
    const input={name:$('user_name').value.trim(),note:$('user_note').value.trim(),enabled:$('user_enabled').checked,startMode:$('user_startMode').value,protocols:[...document.querySelectorAll('[name="userProtocol"]:checked')].map(e=>e.value)};
    for(const k of ['limitGB','durationDays','resetDays'])input[k]=Number($('user_'+k).value);
    if(editing)input.revision=editing.revision;
    try{await api(editing?'/'+editing.id:'',editing?'PATCH':'POST',input);$('userDialog').close();showToast(editing?'کاربر به‌روز شد.':'کاربر ساخته شد.');await load();}
    catch(err){$('userFormError').textContent=err.message;$('userFormError').hidden=false;}
    finally{b.disabled=false;b.textContent=label;}
  });
  function openAction(u,action){
    const messages={toggle:u.enabled?'اتصال‌های این کاربر قطع می‌شوند و تا فعال‌سازی دوباره، اتصال تازه پذیرفته نمی‌شود.':'کاربر دوباره فعال می‌شود؛ حجم و زمان قبلی حفظ می‌شوند.',renew:'روزهای واردشده به اعتبار باقی‌مانده اضافه می‌شود. صفر یعنی زمان نامحدود.',reset:'مصرف سهمیه صفر می‌شود؛ مصرف کل تاریخی حفظ می‌شود.',disconnect:'اتصال‌های باز قطع می‌شوند. کاربر فعال می‌تواند دوباره متصل شود.', 'rotate-link':'لینک ساب قبلی باطل می‌شود. کانفیگ‌های دریافت‌شده همچنان معتبر می‌مانند.', 'rotate-credentials':'کانفیگ‌های قبلی باطل و اتصال‌های باز قطع می‌شوند؛ کاربر باید ساب را در اپ به‌روز کند.',archive:'لینک و اتصال کاربر غیرفعال می‌شود. اطلاعات در بایگانی قابل بازیابی است.',restore:'کاربر از بایگانی بازمی‌گردد؛ حجم و اعتبار قبلی حفظ می‌شوند.'};
    messages.delete='کاربر «'+u.name+'» و سابقهٔ مصرفش برای همیشه حذف می‌شوند. لینک اشتراک و تمام کانفیگ‌های او باطل و اتصال‌های باز قطع می‌شوند. این کار قابل بازگشت نیست؛ برای نگهداری اطلاعات، از بایگانی استفاده کنید.';
    currentAction={u,action};$('userActionTitle').textContent=action==='delete'?'حذف دائمی کاربر':u.name;$('userActionDescription').textContent=messages[action];$('userRenewField').hidden=action!=='renew';$('userRenewDays').disabled=action!=='renew';$('userRenewDays').value=30;$('userActionError').hidden=true;
    $('confirmUserAction').textContent=action==='delete'?'حذف دائمی':'اعمال تغییر';$('confirmUserAction').classList.toggle('danger',action==='delete');$('confirmUserAction').classList.toggle('primary',action!=='delete');
    $('userActionDialog').showModal();
  }
  $('userActionForm').addEventListener('submit',async e=>{
    e.preventDefault();if(!currentAction)return;const b=$('confirmUserAction');if(b.disabled)return;b.disabled=true;const {u,action}=currentAction;
    try{await api('/'+u.id+(['toggle','delete'].includes(action)?'':'/actions'),action==='delete'?'DELETE':action==='toggle'?'PATCH':'POST',action==='delete'?{revision:u.revision}:action==='toggle'?{enabled:!u.enabled,revision:u.revision}:{action,revision:u.revision,...(action==='renew'?{days:Number($('userRenewDays').value)}:{})});$('userActionDialog').close();showToast(action==='delete'?'کاربر حذف شد.':'تغییرات اعمال شد.');await load();}
    catch(err){$('userActionError').textContent=err.message;$('userActionError').hidden=false;}
    finally{b.disabled=false;}
  });
  $('createUser').addEventListener('click',()=>openEditor());$('userSearch').addEventListener('input',render);$('userStatusFilter').addEventListener('change',render);
  document.querySelectorAll('[data-close-user-dialog]').forEach(b=>b.addEventListener('click',()=>$(b.dataset.closeUserDialog).close()));
  $('backupUsers').href=base+'/backup';
  let importBackup=null,importPreview=null,importBusy=false;
  const clearImport=()=>{importBackup=null;importPreview=null;$('userImportPreview').hidden=true;$('confirmUserImport').disabled=true;$('userImportError').hidden=true;};
  const importError=e=>{$('userImportError').textContent=e.message;$('userImportError').hidden=false;};
  function importState(busy){importBusy=busy;$('userBackupFile').disabled=busy;$('previewUserImport').disabled=busy;$('confirmUserImport').disabled=busy||!importPreview?.added;$('userImportDialog').querySelectorAll('[data-close-user-dialog]').forEach(b=>b.disabled=busy);}
  $('restoreUsers').addEventListener('click',()=>{clearImport();$('userImportForm').reset();$('userImportDialog').showModal();});
  $('userBackupFile').addEventListener('change',clearImport);
  $('previewUserImport').addEventListener('click',async()=>{
    if(importBusy)return;clearImport();importState(true);
    try{
      const file=$('userBackupFile').files[0];if(!file)throw new Error('فایل پشتیبان را انتخاب کنید.');
      if(file.size>16*1024*1024)throw new Error('حجم فایل بیشتر از ۱۶ مگابایت است.');
      try{importBackup=JSON.parse(await file.text());}catch(_){throw new Error('فایل JSON معتبر نیست.');}
      importPreview=await api('/import/preview','POST',{backup:importBackup});
      $('userImportSummary').textContent=fa.format(importPreview.added)+' حساب جدید · '+fa.format(importPreview.skipped)+' تکراری (حفظ اطلاعات فعلی) · '+fa.format(importPreview.renamed)+' نام متمایز';
      $('userImportRows').replaceChildren();
      for(const row of importPreview.rows.slice(0,100))$('userImportRows').append(node('li','',row.name+' — '+(row.action==='skip'?'رد: '+row.reason:row.action==='rename'?'افزودن با نام '+row.newName:'افزودن')));
      if(importPreview.rows.length>100)$('userImportRows').append(node('li','', 'نمایش ۱۰۰ ردیف اول از '+fa.format(importPreview.total)+' ردیف؛ خلاصه شامل همهٔ حساب‌هاست.'));
      $('userImportPreview').hidden=false;
    }catch(e){importPreview=null;importError(e);}finally{importState(false);}
  });
  $('userImportForm').addEventListener('submit',async e=>{
    e.preventDefault();if(importBusy||!importPreview?.added)return;importState(true);$('userImportError').hidden=true;
    try{const result=await api('/import','POST',{backup:importBackup,fingerprint:importPreview.fingerprint});$('userImportDialog').close();showToast(fa.format(result.added)+' کاربر بازیابی شد؛ اطلاعات کاربران قبلی حفظ شد.');clearImport();await load();}
    catch(error){importPreview=null;importError(error);}finally{importState(false);}
  });
  $('userImportDialog').addEventListener('cancel',e=>{if(importBusy)e.preventDefault();});
  $('userImportDialog').addEventListener('close',()=>{if(!importBusy)clearImport();});
  const active=()=>$('viewUsers').classList.contains('active')&&document.visibilityState==='visible';
  window.addEventListener('hashchange',()=>{if(active())load();});window.addEventListener('amyrax-refresh',()=>{if(active())load();});
  setInterval(()=>{if(active()&&!$('userDialog').open&&!$('userActionDialog').open&&!$('userImportDialog').open&&!AmyraxControls.isOpen()&&!document.activeElement?.closest('.am-dropdown'))load(true);},5000);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{if(active())load();});else if(active())load();
})();
