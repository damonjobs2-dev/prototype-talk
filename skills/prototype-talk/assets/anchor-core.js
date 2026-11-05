/* Shared by the injected browser overlay and the local Node review store. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PrototypeTalkAnchor = api;
})(globalThis, function () {
  'use strict';

  const compact = (value, limit = 90) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit);
  const identityLabel = (value) => compact(value).replace(/[\d０-９]+(?:[,.，]\d+)*/g, '').replace(/\s+/g, '');
  const volatileId = (value) => /^(?:react-aria|radix-|headlessui-|:r[0-9])/i.test(String(value || ''));
  const weakData = (key, value) => /^(?:data-rac|data-react-aria-pressable|data-hovered|data-pressed|data-focused|data-focus-visible|data-selected|data-disabled|data-state)$/.test(key)
    || key === 'data-slot' && /^(?:button|input|div|span|link|icon|svg)$/.test(String(value || ''));
  const synthetic = (value) => /['"`]\s*\+|\$\{/.test(String(value || ''));

  function compatibleRoute(operation, route) {
    if (!route) return true;
    const discovered = operation.discovered_by || [];
    if (discovered.includes('runtime') && !discovered.some((value) => ['source_scan', 'source_template', 'jsx_ast'].includes(value))) return operation.page_hint === route;
    const current = route.includes('#/') ? `/${route.split('#/')[1].split('?')[0]}` : route.split(/[?#]/)[0];
    if (current === operation.page_hint || operation.page_hint === '/index.html' && current === '/') return true;
    if (route.includes('#/') || current.startsWith('/pages/')) return false;
    return true;
  }

  function hierarchyConflict(operation, target) {
    const stored = operation.anchor?.hierarchy;
    const current = target.hierarchy;
    if (!stored || !current) return false;
    if (stored.item?.key && stored.item.key !== current.item?.key) return true;
    if ((stored.scopes || []).some((scope) => scope.key && !(current.scopes || []).some((item) => item.kind === scope.kind && item.key === scope.key))) return true;
    return false;
  }

  function runtimeIdentityConflict(operation, target) {
    if (hierarchyConflict(operation, target)) return true;
    const data = Object.entries(target.data || {}).filter(([key, value]) => value && !weakData(key, value));
    if (data.some(([key, value]) => (
      operation.instance_data?.[key] && operation.instance_data[key] !== value ||
      operation.coverage === 'observed' && operation.anchor?.data?.[key] && !synthetic(operation.anchor.data[key]) && operation.anchor.data[key] !== value
    ))) return true;
    // Runtime-only records need the same known context; source candidates may lack DOM ancestry.
    const runtimeOnly = operation.discovered_by?.includes('runtime') && !operation.discovered_by.some((value) => ['source_scan', 'source_template', 'jsx_ast'].includes(value));
    if (runtimeOnly && target.hierarchy?.item?.key && !operation.anchor?.hierarchy?.item?.key) return true;
    if (runtimeOnly && (target.hierarchy?.scopes || []).some((scope) => scope.key && !(operation.anchor?.hierarchy?.scopes || []).some((item) => item.kind === scope.kind && item.key === scope.key))) return true;
    if (!operation.discovered_by?.includes('runtime') || !target.label || !operation.label || identityLabel(target.label) === identityLabel(operation.label)) return false;
    const stableMatch = target.id && operation.anchor?.id === target.id && !volatileId(target.id)
      || target.onclick && target.onclick === operation.anchor?.onclick
      || target.href && target.href === operation.anchor?.href
      || data.some(([key, value]) => operation.anchor?.data?.[key] === value);
    return !stableMatch;
  }

  function hierarchyScore(operation, target) {
    const stored = operation.anchor?.hierarchy;
    const current = target.hierarchy;
    if (!stored || !current) return 0;
    let score = stored.item?.key && stored.item.key === current.item?.key ? 18 : 0;
    for (const scope of current.scopes || []) {
      if (scope.key && (stored.scopes || []).some((item) => item.kind === scope.kind && item.key === scope.key)) score += 8;
    }
    return score;
  }

  function matchRuntimeControl(operations, target, route = '') {
    let best = null;
    let bestScore = 0;
    let tied = false;
    for (const operation of operations || []) {
      if (!compatibleRoute(operation, route) || runtimeIdentityConflict(operation, target)) continue;
      const anchor = operation.anchor || {};
      let score = hierarchyScore(operation, target);
      if (target.id && !volatileId(target.id) && anchor.id === target.id) score += 9;
      if (target.selector_unique && target.selector && !/^[a-z]+$/i.test(target.selector) && !volatileId(target.selector.replace(/^#/, '')) && anchor.selector === target.selector) score += 12;
      if (target.form && anchor.form === target.form) score += 8;
      if (target.onclick && anchor.onclick === target.onclick) score += 12;
      if (target.href && anchor.href === target.href) score += 6;
      for (const [key, value] of Object.entries(target.data || {})) {
        if (weakData(key, value)) continue;
        if (anchor.data?.[key] === value && value) score += key === 'data-testid' || key === 'data-test' || key === 'data-qa' ? 16 : 8;
        else if (key in (anchor.data || {}) && !anchor.data[key]) score += 4;
      }
      if (target.label && operation.label === target.label) score += 6;
      else if (target.label && operation.label?.includes(target.label) && target.label.length > 3) score += 2;
      if (target.tag && operation.tag === target.tag) score++;
      if (route && route.includes(operation.page_hint) && operation.page_hint !== '/') score += 3;
      if (score > bestScore) { best = operation; bestScore = score; tied = false; }
      else if (score === bestScore && score >= 6) tied = true;
    }
    return bestScore >= 6 && !tied ? best : null;
  }

  function nodeName(node) {
    const labelledBy = node.getAttribute('aria-labelledby');
    const referenced = labelledBy && node.ownerDocument?.getElementById(labelledBy.split(/\s+/)[0]);
    const heading = node.querySelector('legend,h1,h2,h3,h4,[role="heading"]');
    return compact(node.getAttribute('aria-label') || referenced?.textContent || heading?.textContent || node.getAttribute('name') || '', 70);
  }

  function scopeOf(node) {
    const tag = node.tagName?.toLowerCase();
    const role = node.getAttribute('role');
    const classes = String(node.className || '');
    let kind = '';
    if (tag === 'dialog' || role === 'dialog' || node.getAttribute('aria-modal') === 'true' || /(?:^|\s)(?:modal|drawer|sheet)(?:\s|$)/.test(classes)) kind = 'dialog';
    else if (tag === 'form' || role === 'form') kind = 'form';
    else if (role === 'tabpanel') kind = 'tabpanel';
    else if (tag === 'section' || role === 'region') kind = 'section';
    if (!kind) return null;
    const stableId = !volatileId(node.id) ? node.id : '';
    const key = compact(node.getAttribute('data-testid') || node.getAttribute('data-qa') || stableId || nodeName(node), 70);
    return { kind, key };
  }

  function itemOf(node) {
    const row = node.closest('tr,[role="row"],li,[role="listitem"],[data-row-key],[data-item-id]');
    if (!row) return null;
    const explicit = ['data-row-key', 'data-item-id', 'data-record-id', 'data-id', 'data-key', 'data-testid'].map((name) => row.getAttribute(name)).find(Boolean);
    const cells = [...row.querySelectorAll('th,td,[role="rowheader"],[role="cell"]')].slice(0, 5);
    const visible = cells.map((cell) => compact(cell.textContent, 70)).find((value) => value && !/^\d+$/.test(value) && !/\b1\d{10}\b|@/.test(value));
    const key = compact(explicit || row.getAttribute('aria-label') || visible || '', 70);
    return key ? { kind: row.matches('tr,[role="row"]') ? 'row' : 'item', key } : null;
  }

  function hierarchyFor(element, page) {
    const scopes = [];
    for (let node = element.parentElement; node && node !== element.ownerDocument?.body; node = node.parentElement) {
      const scope = scopeOf(node);
      if (scope?.key && !scopes.some((item) => item.kind === scope.kind && item.key === scope.key)) scopes.unshift(scope);
    }
    return { page, scopes: scopes.slice(-4), item: itemOf(element) };
  }

  return { compatibleRoute, hierarchyFor, matchRuntimeControl, runtimeIdentityConflict, volatileId, weakData };
});
