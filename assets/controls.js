(() => {
  let sequence = 0, active = null;
  const selects = new WeakMap();
  const make = (tag, className, text) => {
    const element = document.createElement(tag);
    element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  };
  const paths = {
    more: 'M5 12h.01M12 12h.01M19 12h.01',
    chevron: 'm6 9 6 6 6-6',
    check: 'm5 12 4 4L19 6',
    toggle: 'M12 3v9M7 5a8 8 0 1 0 10 0',
    renew: 'M8 3v4M16 3v4M4 10h16M12 13v5M9.5 15.5h5M6 5h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2',
    reset: 'M3 10a9 9 0 1 1 2 8M3 4v6h6',
    disconnect: 'm4 4 16 16M8 8l-3 3a4 4 0 0 0 6 6l2-2M11 5l2-2a4 4 0 0 1 6 6l-2 2',
    'rotate-link': 'M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2',
    'rotate-credentials': 'M15 11a4 4 0 1 0-3-7 4 4 0 0 0 3 7ZM12 10 3 19v2h3v-3h3v-3h3',
    archive: 'M3 4h18v5H3zM5 9v11h14V9M10 13h4',
    restore: 'M3 4h18v5H3zM5 9v11h14V9m-10 6 3-3 3 3m-3-3v6',
    delete: 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7'
  };
  function icon(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(svg.namespaceURI, 'path');
    path.setAttribute('d', paths[name] || paths.more);
    svg.append(path);
    return svg;
  }
  function create({ label, ariaLabel, options, onSelect, menu = false, className = '' }) {
    const root = make('div', 'am-dropdown ' + className);
    const trigger = make('button', 'am-select-trigger');
    trigger.type = 'button';
    trigger.id = 'am-control-' + ++sequence;
    trigger.setAttribute('aria-haspopup', menu ? 'menu' : 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    if (ariaLabel) trigger.setAttribute('aria-label', ariaLabel);
    const caption = make('span', 'am-select-caption', label);
    if (menu) trigger.append(icon('more'));
    trigger.append(caption, icon('chevron'));
    const popup = make('div', 'am-select-popup');
    const optionsPane = make('div', 'am-select-options');
    optionsPane.setAttribute('role', 'presentation');
    popup.append(optionsPane);
    popup.id = trigger.id + '-popup';
    popup.hidden = true;
    popup.setAttribute('role', menu ? 'menu' : 'listbox');
    popup.setAttribute('aria-labelledby', trigger.id);
    trigger.setAttribute('aria-controls', popup.id);
    const popover = typeof popup.showPopover === 'function';
    if (popover) popup.setAttribute('popover', 'manual');
    root.append(trigger, popup);
    let items = [], current = 0, search = '', searchedAt = 0;
    function position() {
      if (active !== control) return;
      const rect = trigger.getBoundingClientRect(), vv = window.visualViewport;
      const leftEdge = (vv?.offsetLeft || 0) + 12, topEdge = (vv?.offsetTop || 0) + 12;
      const rightEdge = leftEdge + (vv?.width || innerWidth) - 24;
      const bottomEdge = topEdge + (vv?.height || innerHeight) - 24;
      if (!trigger.isConnected || rect.bottom < topEdge || rect.top > bottomEdge) return close();
      const width = Math.min(menu ? 256 : Math.max(rect.width, 240), rightEdge - leftEdge);
      popup.style.width = width + 'px';
      const below = Math.max(0, bottomEdge - rect.bottom - 8);
      const above = Math.max(0, rect.top - topEdge - 8);
      const desired = Math.min(optionsPane.scrollHeight + 16, 420);
      const up = below < desired && above > below;
      const available = up ? above : below;
      popup.style.maxHeight = Math.min(420, available) + 'px';
      const height = popup.getBoundingClientRect().height;
      const x = Math.max(leftEdge, Math.min(rect.right - width, rightEdge - width));
      const y = Math.max(topEdge, up ? rect.top - height - 8 : rect.bottom + 8);
      popup.style.left = x + 'px';
      popup.style.top = y + 'px';
      const placed = popup.getBoundingClientRect();
      popup.style.left = x - (placed.left - x) + 'px';
      popup.style.top = y - (placed.top - y) + 'px';
      popup.dataset.side = up ? 'above' : 'below';
    }
    function focus(index) {
      current = (index + items.length) % items.length;
      items[current]?.focus({ preventScroll: true });
      items[current]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
    function close(restore = false) {
      if (active !== control) return;
      active = null;
      if (popover && popup.matches(':popover-open')) popup.hidePopover();
      popup.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
      if (!popover) root.append(popup);
      if (restore && trigger.isConnected) trigger.focus({ preventScroll: true });
    }
    function open(last = false) {
      if (trigger.disabled) return;
      active?.close();
      items = []; search = '';
      optionsPane.replaceChildren();
      options().forEach(option => {
        const item = make(menu ? 'button' : 'div', 'am-select-option');
        if (menu) item.type = 'button';
        item.tabIndex = -1;
        item.setAttribute('role', menu ? 'menuitem' : 'option');
        if (!menu) item.setAttribute('aria-selected', String(!!option.selected));
        if (option.danger) item.classList.add('am-option-danger');
        if (option.disabled) item.setAttribute('aria-disabled', 'true');
        if (menu) item.append(icon(option.value));
        item.append(make('span', 'am-option-caption', option.label));
        if (!menu) item.append(icon('check'));
        if (!option.disabled) {
          items.push(item);
          item.addEventListener('focus', () => { current = items.indexOf(item); });
          item.addEventListener('click', () => { close(true); onSelect(option.value); });
        }
        optionsPane.append(item);
      });
      if (!items.length) return;
      active = control;
      popup.hidden = false;
      if (popover) popup.showPopover();
      else (root.closest('dialog') || document.body).append(popup);
      trigger.setAttribute('aria-expanded', 'true');
      position();
      const selected = items.findIndex(item => item.getAttribute('aria-selected') === 'true');
      focus(last ? items.length - 1 : Math.max(0, selected));
    }
    trigger.addEventListener('click', () => active === control ? close() : open());
    trigger.addEventListener('keydown', event => {
      if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
        event.preventDefault(); open(event.key === 'ArrowUp');
      }
    });
    popup.addEventListener('keydown', event => {
      const key = event.key;
      if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' '].includes(key)) {
        event.preventDefault();
        if (key === 'Enter' || key === ' ') items[current]?.click();
        else focus(key === 'Home' ? 0 : key === 'End' ? items.length - 1 : current + (key === 'ArrowDown' ? 1 : -1));
      } else if (key === 'Tab') close(true);
      else if (key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
        search = (Date.now() - searchedAt > 700 ? '' : search) + key.toLocaleLowerCase();
        searchedAt = Date.now();
        const found = items.findIndex(item => item.textContent.trim().toLocaleLowerCase().startsWith(search));
        if (found >= 0) focus(found);
      }
    });
    const control = { root, trigger, popup, caption, open, close, position };
    return control;
  }
  function enhance(select) {
    if (selects.has(select) || select.multiple) return;
    const label = select.getAttribute('aria-label') || [...(select.labels || [])].map(l => [...l.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim()).join(' ');
    const control = create({
      ariaLabel: label,
      options: () => [...select.options].map(o => ({ value: o.value, label: o.textContent, selected: o.selected, disabled: o.disabled })),
      onSelect(value) {
        const changed = select.value !== value;
        select.value = value; sync(select);
        if (changed) {
          select.dispatchEvent(new Event('input', { bubbles: true }));
          select.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
    });
    control.trigger.id = select.id + 'Control';
    control.popup.setAttribute('aria-labelledby', control.trigger.id);
    const labels = [...(select.labels || [])];
    select.after(control.root);
    select.hidden = true;
    select.dataset.themed = 'true';
    labels.filter(l => l.htmlFor === select.id).forEach(l => { l.htmlFor = control.trigger.id; });
    selects.set(select, control);
    control.ariaLabel = label;
    select.addEventListener('change', () => sync(select));
    select.form?.addEventListener('reset', () => setTimeout(() => sync(select), 0));
    sync(select);
  }
  function sync(select) {
    const control = selects.get(select);
    if (!control) return;
    control.caption.textContent = select.selectedOptions[0]?.textContent || '';
    control.trigger.setAttribute('aria-label', [control.ariaLabel, control.caption.textContent].filter(Boolean).join('، '));
    control.trigger.disabled = select.disabled;
  }
  document.addEventListener('pointerdown', event => {
    if (active && !active.root.contains(event.target) && !active.popup.contains(event.target)) active.close();
  });
  document.addEventListener('focusin', event => {
    if (active && !active.root.contains(event.target) && !active.popup.contains(event.target)) active.close();
  });
  document.addEventListener('keydown', event => {
    if (active && event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation(); active.close(true);
    }
  }, true);
  document.addEventListener('scroll', event => {
    if (active && !active.popup.contains(event.target)) active.position();
  }, true);
  window.addEventListener('resize', () => active?.position());
  window.visualViewport?.addEventListener('resize', () => active?.position());
  window.visualViewport?.addEventListener('scroll', () => active?.position());
  window.addEventListener('hashchange', () => active?.close());
  document.addEventListener('close', event => {
    if (active && event.target.contains(active.root)) active.close();
  }, true);
  window.AmyraxControls = {
    menu: config => create({ ...config, menu: true }).root,
    sync,
    isOpen: () => !!active,
    close: () => active?.close()
  };
  document.querySelectorAll('select[data-panel-select]').forEach(enhance);
})();
