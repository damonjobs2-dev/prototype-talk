import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildSourceRegions, reconcileRegion } from './source-regions.mjs';
import { ReviewStore } from './store.mjs';
import { mergeRuntimeFields } from './display-fields.mjs';

const files = new Map([
  ['src/Experience.jsx', `import Home from './Home';\nconst modeTabs = [{ id:'hot', label:'热点' }, { id:'follow', label:'订阅' }];\nconst screen = new URLSearchParams(location.search).get('screen');\nconst hotPage = <Home count={count}/>;\nconst followPage = <div>订阅</div>;\nconst topLevel = { hot: hotPage, follow: followPage }[tab];\nconst go = (next) => { setTab(next); history.replaceState(null, '', '?screen='+next); };\nconst navigation = edition === 'radar' ? modeTabs : [{ id:'hot', label:'首页' }];\nconst navigate = (id) => go(id);\nconst bottom = navigation.map(({id,label}) => <button onClick={()=>navigate(id)}>{label}</button>);`],
  ['src/Home.jsx', `export default function Home({count, edition}) { return <main>{edition === 'a' ? <><p>正在监测 {count} 个方案</p>{items.map(item => <article><strong>{item.title}</strong><span>在榜 {item.onListTime} 分钟</span></article>)}</> : <div>其他版本</div>}</main> }`],
]);

test('source graph maps a navigation target to its component and keeps display conditions', () => {
  const graph = buildSourceRegions(files);
  assert.ok(graph.regions.some((item) => item.page_path === '/?screen=hot' && item.component === 'Home'));
  assert.ok(graph.links.some((item) => item.trigger_label === '首页' && item.target_region_id === '/?screen=hot'));
  assert.deepEqual(graph.links.find((item) => item.trigger_label === '首页').handler_chain.map((item) => item.name), ['navigate', 'go']);
  const fields = graph.fields.filter((item) => item.page_path === '/?screen=hot');
  assert.ok(fields.some((item) => item.source_key === 'item.title' && item.label === '标题'));
  assert.ok(fields.some((item) => item.source_key === 'item.onListTime'));
  assert.ok(fields.some((item) => item.source_key === 'count' && item.source_conditions.some((condition) => condition.includes("edition === 'a'"))));
  assert.ok(!graph.fields.some((item) => item.page_path === '/?screen=follow' && item.source_key === 'item.title'));
});

test('runtime region agreement and disagreement remain separate from source inference', () => {
  const graph = buildSourceRegions(files);
  const matched = reconcileRegion(graph.links, { target: { label: '首页' }, observed_region: { scope: 'page', page_path: '/?screen=hot', label: '首页' } });
  const mismatch = reconcileRegion(graph.links, { target: { label: '首页' }, observed_region: { scope: 'page', page_path: '/?screen=follow', label: '订阅' } });
  assert.equal(matched.status, 'matched');
  assert.equal(mismatch.status, 'mismatch');
  assert.deepEqual(mismatch.source_targets, ['/?screen=hot']);
});

test('HTML links produce source page edges without treating the click as an observed result', () => {
  const graph = buildSourceRegions(new Map([['pages/list.html', '<title>列表</title><a href="detail.html">查看详情</a>'], ['pages/detail.html', '<title>详情</title>']]));
  assert.ok(graph.links.some((item) => item.trigger_label === '查看详情' && item.target_region_id === '/pages/detail.html' && item.status === 'source_inferred'));
  assert.equal(reconcileRegion(graph.links, { target: { label: '查看详情' } }).status, 'source_only');
});

test('hash-routed JavaScript pages expose template display data before a click', () => {
  const graph = buildSourceRegions(new Map([
    ['assets/js/app.js', `import { renderHome } from './views/home.js?v=1'; function parseHash(){ return location.hash; } function resolve(path){ if (path === '/' || path === '/home') return { html: renderHome(), title: '首页' }; }`],
    ['assets/js/views/home.js', `export function renderHome(){ return \`<section class="screen"><article class="topic"><strong>\${item.title}</strong><span>热度 \${item.heat}</span></article></section>\`; }`],
  ]));
  assert.ok(graph.regions.some((item) => item.page_path === '/home'));
  assert.ok(graph.fields.some((item) => item.page_path === '/home' && item.source_key === 'item.title' && item.dom_candidates.some((candidate) => candidate.selector.includes('.topic strong'))));
  assert.ok(graph.fields.some((item) => item.page_path === '/home' && item.source_key === 'item.heat'));
});

test('visible DOM binding verifies the matching source field without creating a second row', () => {
  const source = buildSourceRegions(files).fields.find((item) => item.page_path === '/?screen=hot' && item.source_key === 'item.title');
  const merged = mergeRuntimeFields([source], [{ page_path: '/?screen=hot', kind: 'display_value', key: 'item.title', label: '标题', visible: true, usage: 'display' }], 'snapshot-1');
  assert.equal(merged.length, 1);
  assert.equal(merged[0].runtime_visible, true);
  assert.equal(merged[0].last_seen_snapshot_id, 'snapshot-1');
});

test('review store retains a source/runtime region mismatch and marks only actually observed fields', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prototype-region-'));
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'prototype-region-out-'));
  try {
    fs.mkdirSync(path.join(root, 'src'));
    for (const [file, source] of files) fs.writeFileSync(path.join(root, file), source);
    const store = new ReviewStore(root, out);
    const operation = store.data.operations.find((item) => item.label === 'button');
    const field = store.data.display_fields.find((item) => item.page_path === '/?screen=hot' && item.source_key === 'item.title');
    assert.ok(field);
    const input = { target: { tag: 'button', label: '首页', data: {}, selector: 'button' }, trigger: 'click', before: { route: '/?screen=follow', visible_text: '订阅' }, after: { route: '/?screen=follow', visible_text: '订阅' }, observed_region: { scope: 'page', page_path: '/?screen=follow', label: '订阅', observed_field_ids: [field.field_id] } };
    const recorded = store.addTrace(input);
    assert.equal(recorded.trace.region_reconciliation.status, 'mismatch');
    assert.equal(store.data.display_fields.find((item) => item.field_id === field.field_id).runtime_visible, undefined);
    assert.equal(store.publicState().operation_observations.at(-1).region_reconciliation.status, 'mismatch');
  } finally { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(out, { recursive: true, force: true }); }
});
