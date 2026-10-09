(() => {
  const root = document.documentElement;
  const notice = document.querySelector('.toast[role="status"]');
  let noticeTimer;
  function notify(message) {
    notice.textContent = message;
    notice.classList.add('show');
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => notice.classList.remove('show'), 2800);
  }
  const themeButton = document.querySelector('#theme-toggle');
  function applyTheme(theme) {
    root.dataset.theme = theme;
    themeButton.setAttribute('aria-label', theme === 'light' ? 'فعال‌کردن تم تیره' : 'فعال‌کردن تم روشن');
    themeButton.setAttribute('aria-pressed', String(theme === 'light'));
    document.querySelector('meta[name="theme-color"]').content = theme === 'light' ? '#f4f6f3' : '#1a1f25';
  }
  try { applyTheme(localStorage.getItem('amyrax-guide-theme') === 'light' ? 'light' : 'dark'); } catch { applyTheme('dark'); }
  themeButton.addEventListener('click', () => {
    const theme = root.dataset.theme === 'light' ? 'dark' : 'light';
    applyTheme(theme);
    try { localStorage.setItem('amyrax-guide-theme', theme); } catch {}
  });
  const supportNotice = document.querySelector('#support-notice');
  function dismissSupportNotice() {
    const hadFocus = supportNotice.contains(document.activeElement);
    supportNotice.hidden = true;
    if (hadFocus) document.querySelector('.brand').focus({ preventScroll: true });
  }
  supportNotice.querySelectorAll('[data-dismiss-support]').forEach(button => {
    button.addEventListener('click', dismissSupportNotice);
  });
  supportNotice.querySelector('a').addEventListener('click', dismissSupportNotice);
  supportNotice.hidden = false;
  const setupVideo = document.querySelector('#setup-video');
  const videoStart = document.querySelector('#video-start');
  videoStart.hidden = false;
  setupVideo.controls = false;
  setupVideo.addEventListener('play', () => {
    videoStart.hidden = true;
    setupVideo.controls = true;
  });
  videoStart.addEventListener('click', async () => {
    videoStart.hidden = true;
    setupVideo.controls = true;
    setupVideo.focus({ preventScroll: true });
    try { await setupVideo.play(); } catch {
      notify('برای پخش، دکمهٔ پخش روی ویدئو را بزن.');
    }
  });
  const menuButton = document.querySelector('#menu-toggle');
  const menu = document.querySelector('#site-nav');
  menuButton.addEventListener('click', () => {
    const opened = menu.classList.toggle('open');
    menuButton.setAttribute('aria-expanded', String(opened));
    menuButton.setAttribute('aria-label', opened ? 'بستن منو' : 'بازکردن منو');
  });
  menu.querySelectorAll('a').forEach(link => link.addEventListener('click', () => {
    menu.classList.remove('open');
    menuButton.setAttribute('aria-expanded', 'false');
    menuButton.setAttribute('aria-label', 'بازکردن منو');
  }));
  document.addEventListener('keydown', event => {
    if (document.querySelector('#image-viewer')?.open) return;
    if (event.key === 'Escape') {
      if (!supportNotice.hidden) dismissSupportNotice();
      menu.classList.remove('open');
      menuButton.setAttribute('aria-expanded', 'false');
      menuButton.setAttribute('aria-label', 'بازکردن منو');
    }
  });
  const imageViewer = document.querySelector('#image-viewer');
  const viewerImage = document.querySelector('#viewer-image');
  const viewerCaption = document.querySelector('#viewer-caption');
  const imageLinks = [...document.querySelectorAll('.image-zoom')];
  let imageIndex = 0;
  let imageOpener;
  let previousOverflow;
  function displayImage(index) {
    imageIndex = (index + imageLinks.length) % imageLinks.length;
    const link = imageLinks[imageIndex];
    const image = link.querySelector('img');
    viewerImage.src = link.href;
    viewerImage.alt = image.alt;
    viewerCaption.textContent = link.closest('.step-view')?.querySelector('h3').textContent || 'صفحهٔ اشتراک Amyrax Panel';
    viewerCaption.setAttribute('aria-live', 'polite');
  }
  imageLinks.forEach((link, index) => link.addEventListener('click', event => {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || typeof imageViewer.showModal !== 'function') return;
    event.preventDefault();
    imageOpener = link;
    previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    displayImage(index);
    imageViewer.showModal();
  }));
  imageViewer.querySelector('.viewer-close').addEventListener('click', () => imageViewer.close());
  imageViewer.querySelector('.viewer-previous').addEventListener('click', () => displayImage(imageIndex - 1));
  imageViewer.querySelector('.viewer-next').addEventListener('click', () => displayImage(imageIndex + 1));
  imageViewer.addEventListener('keydown', event => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      displayImage(imageIndex + (event.key === 'ArrowRight' ? 1 : -1));
    }
  });
  imageViewer.addEventListener('click', event => {
    if (event.target === imageViewer) imageViewer.close();
  });
  imageViewer.addEventListener('close', () => {
    document.body.style.overflow = previousOverflow;
    if (imageOpener?.isConnected) imageOpener.focus({ preventScroll: true });
  });
  let swipeStart;
  imageViewer.addEventListener('pointerdown', event => {
    swipeStart = event.pointerType === 'touch' && event.isPrimary ? { x: event.clientX, y: event.clientY } : null;
  });
  imageViewer.addEventListener('pointerup', event => {
    if (!swipeStart) return;
    const dx = event.clientX - swipeStart.x;
    const dy = event.clientY - swipeStart.y;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 2) displayImage(imageIndex + (dx < 0 ? 1 : -1));
    swipeStart = null;
  });
  imageViewer.addEventListener('pointercancel', () => { swipeStart = null; });
  document.querySelectorAll('.copy-button').forEach(button => button.addEventListener('click', async () => {
    const text = button.parentElement.querySelector('code').textContent;
    try {
      await navigator.clipboard.writeText(text);
      notify('متن کپی شد.');
    } catch {
      const range = document.createRange();
      range.selectNodeContents(button.parentElement.querySelector('code'));
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      notify('متن انتخاب شد؛ با گزینهٔ کپی مرورگر آن را بردار.');
    }
  }));
  function makeTabs(groupSelector, panelSelector) {
    const group = document.querySelector(groupSelector);
    const tabs = [...group.querySelectorAll('[role="tab"]')];
    const panels = [...document.querySelectorAll(panelSelector)];
    function activate(tab, focus = false) {
      tabs.forEach(item => {
        item.setAttribute('aria-selected', String(item === tab));
        item.tabIndex = item === tab ? 0 : -1;
      });
      panels.forEach(panel => { panel.hidden = panel.id !== tab.getAttribute('aria-controls'); });
      if (focus) tab.focus();
    }
    tabs.forEach((tab, index) => {
      tab.addEventListener('click', () => activate(tab));
      tab.addEventListener('keydown', event => {
        let next;
        if (event.key === 'Home') next = 0;
        if (event.key === 'End') next = tabs.length - 1;
        if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next = (index + 1) % tabs.length;
        if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next = (index + tabs.length - 1) % tabs.length;
        if (next !== undefined) { event.preventDefault(); activate(tabs[next], true); }
      });
    });
    activate(tabs.find(tab => tab.getAttribute('aria-selected') === 'true') || tabs[0]);
    return { tabs, activate };
  }
  const steps = makeTabs('#step-tabs', '.step-view');
  document.querySelectorAll('[data-next-step]').forEach(button => button.addEventListener('click', () => {
    steps.activate(steps.tabs[Number(button.dataset.nextStep)], true);
  }));
  makeTabs('#os-tabs', '.client-panel');
  const faqSearch = document.querySelector('#faq-search');
  const filterButtons = [...document.querySelectorAll('[data-faq-category]')];
  const faqItems = [...document.querySelectorAll('.faq-item')];
  let category = 'all';
  const normalize = text => text.toLowerCase().replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/\u200c/g, ' ');
  function filterFaq() {
    const words = normalize(faqSearch.value).trim().split(/\s+/).filter(Boolean);
    let count = 0;
    faqItems.forEach(item => {
      const matches = (category === 'all' || item.dataset.category === category) && words.every(word => normalize(item.textContent).includes(word));
      item.hidden = !matches;
      if (matches) count++;
    });
    document.querySelector('#faq-empty').hidden = count > 0;
    document.querySelector('#faq-count').textContent = count + ' پاسخ پیدا شد.';
  }
  filterButtons.forEach(button => button.addEventListener('click', () => {
    category = button.dataset.faqCategory;
    filterButtons.forEach(item => item.setAttribute('aria-pressed', String(item === button)));
    filterFaq();
  }));
  faqSearch.addEventListener('input', filterFaq);
  if ('IntersectionObserver' in window) {
    const navLinks = [...menu.querySelectorAll('a[href^="#"]')];
    const sectionObserver = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        navLinks.forEach(link => {
          if (link.hash === '#' + entry.target.id) link.setAttribute('aria-current', 'location');
          else link.removeAttribute('aria-current');
        });
      });
    }, { rootMargin: '-15% 0px -65% 0px', threshold: 0 });
    navLinks.forEach(link => {
      const section = document.querySelector(link.hash);
      if (section) sectionObserver.observe(section);
    });
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const observer = new IntersectionObserver(entries => {
        entries.forEach(entry => {
          if (entry.isIntersecting) { entry.target.classList.add('visible'); observer.unobserve(entry.target); }
        });
      }, { threshold: 0.05 });
      root.classList.add('enhanced');
      document.querySelectorAll('.reveal').forEach(item => { item.classList.add('ready'); observer.observe(item); });
    }
  }
})();
