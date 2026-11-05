// Shared component vocabulary. Web detection is active; App names are reference matches for a future adapter.
export const CATALOG_VERSION = 2;
const q = (key, label, options = null) => options ? { key, label, type: 'choice', options } : { key, label, type: 'text' };
const yn = ['是', '否', '按条件', '暂未确定'];
const singleMulti = ['单选', '多选', '暂未确定'];

export const COMPONENTS = [
  { id: 'text_input', label: '文本输入', platforms: ['web', 'app'], examples: ['input[type=text/email/tel/url/password]', 'TextField', 'UITextField'], attributes: ['required', 'minlength', 'maxlength', 'pattern', 'readonly', 'autocomplete'], actions: ['focus', 'input', 'blur', 'validate'], questions: [q('required', '什么条件下必填？', ['总是', '选填', '按条件', '暂未确定']), q('format', '还有哪些格式或唯一性规则？'), q('validate_at', '何时校验？', ['输入时', '失焦时', '提交时', '暂未确定'])] },
  { id: 'number_input', label: '数值输入', platforms: ['web', 'app'], examples: ['input[type=number]', 'NumberField', 'Stepper'], attributes: ['min', 'max', 'step', 'precision', 'unit', 'readonly'], actions: ['input', 'increment', 'validate'], questions: [q('range', '允许的数值范围和精度是多少？'), q('unit', '单位与步长是什么？'), q('out_of_range', '超出范围时如何处理？')] },
  { id: 'date_time', label: '日期时间', platforms: ['web', 'app'], examples: ['input[type=date/time/datetime-local]', 'DatePicker', 'UIDatePicker'], attributes: ['min', 'max', 'timezone', 'granularity', 'disabled_dates'], actions: ['open', 'select', 'clear'], questions: [q('date_range', '可选日期或时间范围是什么？'), q('timezone', '按哪个时区和时间粒度处理？'), q('date_dependency', '与起止时间或其他字段有什么约束？')] },
  { id: 'file_upload', label: '文件或图片上传', platforms: ['web', 'app'], examples: ['input[type=file]', 'PhotoPicker', 'DocumentPicker'], attributes: ['accept', 'multiple', 'max_size', 'camera', 'preview'], actions: ['choose', 'upload', 'remove', 'retry'], questions: [q('file_limits', '允许哪些格式、数量和大小？'), q('upload_timing', '选择后立即上传还是提交时上传？', ['立即上传', '提交时上传', '暂未确定']), q('upload_failure', '上传失败、取消或重试如何处理？')] },
  { id: 'single_select', label: '单选下拉', platforms: ['web', 'app'], examples: ['select', 'Combobox', 'DropdownMenu', 'UIPickerView'], attributes: ['options', 'selected_value', 'placeholder', 'searchable', 'disabled'], actions: ['open', 'choose', 'clear'], questions: [q('selection_mode', '一次可以选几个？', singleMulti), q('selection_dependency', '选项会随哪个字段变化？'), q('selection_effect', '选中后影响哪个字段或结果？')] },
  { id: 'multi_select', label: '多选或级联选择', platforms: ['web', 'app'], examples: ['select[multiple]', 'TreeSelect', 'Cascader', 'ChipGroup'], attributes: ['options', 'selected_values', 'min_count', 'max_count', 'parent_child'], actions: ['select', 'deselect', 'clear'], questions: [q('selection_limit', '最少和最多可选几个？'), q('selection_linkage', '父子选项如何联动？'), q('selection_effect', '选择变化影响哪里？')] },
  { id: 'checkbox', label: '复选框', platforms: ['web', 'app'], examples: ['input[type=checkbox]', 'Checkbox', 'UICheckbox'], attributes: ['checked', 'indeterminate', 'disabled', 'group'], actions: ['check', 'uncheck'], questions: [q('toggle_effect', '勾选或取消控制哪些功能？'), q('toggle_linkage', '与上级、下级如何联动？', ['上级控制子项', '子项可独立选择', '不联动', '暂未确定']), q('toggle_effective', '何时生效？', ['立即', '保存后', '后续创建时', '暂未确定'])] },
  { id: 'radio_group', label: '单选组', platforms: ['web', 'app'], examples: ['input[type=radio]', 'RadioButton', 'UISegmentedControl'], attributes: ['group', 'selected', 'disabled'], actions: ['choose'], questions: [q('radio_default', '默认选中什么？'), q('radio_exclusive', '是否只能选一项？', yn), q('radio_effect', '切换后影响哪些内容？')] },
  { id: 'switch', label: '开关', platforms: ['web', 'app'], examples: ['role=switch', 'Switch', 'UISwitch'], attributes: ['checked', 'disabled', 'loading'], actions: ['turn_on', 'turn_off'], questions: [q('switch_effect', '开启与关闭分别影响什么？'), q('switch_effective', '立即生效还是保存后生效？', ['立即', '保存后', '暂未确定']), q('switch_failure', '失败时是否恢复原状态？', yn)] },
  { id: 'slider', label: '滑块', platforms: ['web', 'app'], examples: ['input[type=range]', 'Slider', 'UISlider'], attributes: ['min', 'max', 'step', 'value'], actions: ['drag', 'release'], questions: [q('slider_range', '范围、步长和单位是什么？'), q('slider_effective', '拖动时还是松手后生效？', ['拖动时', '松手后', '保存后', '暂未确定'])] },
  { id: 'search_filter', label: '搜索与筛选', platforms: ['web', 'app'], examples: ['input[type=search]', 'SearchBar', 'UISearchBar'], attributes: ['query', 'filters', 'debounce', 'empty_state'], actions: ['type', 'search', 'clear'], questions: [q('search_trigger', '输入即搜索还是点击后搜索？', ['输入即搜索', '点击后搜索', '暂未确定']), q('search_scope', '搜索哪些字段和数据范围？'), q('search_empty', '无结果时显示什么？')] },
  { id: 'submit_action', label: '提交或保存', platforms: ['web', 'app'], examples: ['button[type=submit]', 'SaveButton', 'PrimaryAction'], attributes: ['enabled', 'loading', 'idempotency'], actions: ['validate', 'submit', 'result'], questions: [q('submit_success', '成功后出现什么可验证结果？'), q('submit_failure', '失败时如何提示或回退？'), q('submit_objects', '会修改哪些业务对象？')] },
  { id: 'button_action', label: '普通按钮', platforms: ['web', 'app'], examples: ['button', 'IconButton', 'UIButton'], attributes: ['enabled', 'loading', 'destructive'], actions: ['click', 'result'], questions: [q('button_effect', '点击后哪个区域或对象变化？'), q('button_data_change', '这一步是否立即修改数据？', ['只改变界面', '立即修改数据', '暂未确定'])] },
  { id: 'download_action', label: '下载或导出', platforms: ['web', 'app'], examples: ['a[download]', 'ExportButton', 'ShareSheet'], attributes: ['file_type', 'name', 'permission', 'expiry'], actions: ['request', 'download', 'retry'], questions: [q('download_content', '下载内容、格式和文件名如何确定？'), q('download_permission', '哪些角色或状态可以下载？'), q('download_failure', '文件不存在或下载失败如何提示？')] },
  { id: 'navigation', label: '页面导航', platforms: ['web', 'app'], examples: ['a[href]', 'NavigationBar', 'UITabBar'], attributes: ['destination', 'parameters', 'back_state'], actions: ['navigate', 'back'], questions: [q('nav_target', '跳转到哪里并带哪些参数？'), q('nav_back', '返回后保留哪些筛选或输入状态？')] },
  { id: 'tab', label: '页签', platforms: ['web', 'app'], examples: ['role=tab', 'TabRow', 'UITabBar'], attributes: ['selected', 'panel', 'lazy_load'], actions: ['switch'], questions: [q('tab_content', '切换后展示哪组内容？'), q('tab_loading', '切换时何时重新获取数据？', ['不获取', '首次进入', '每次切换', '暂未确定'])] },
  { id: 'disclosure', label: '折叠或展开', platforms: ['web', 'app'], examples: ['details/summary', 'Accordion', 'DisclosureGroup'], attributes: ['expanded', 'controlled_region'], actions: ['expand', 'collapse'], questions: [q('disclosure_scope', '展开或收起哪部分内容？'), q('disclosure_state', '再次进入时是否记住状态？', yn)] },
  { id: 'dialog', label: '弹窗或抽屉', platforms: ['web', 'app'], examples: ['dialog', 'BottomSheet', 'UIAlertController'], attributes: ['modal', 'close_paths', 'draft_state'], actions: ['open', 'confirm', 'cancel'], questions: [q('dialog_close', '关闭、取消和遮罩点击如何处理？'), q('dialog_draft', '未提交的输入是否保留？', yn)] },
  { id: 'menu', label: '菜单与更多操作', platforms: ['web', 'app'], examples: ['role=menu', 'DropdownMenu', 'UIMenu'], attributes: ['items', 'availability', 'selection'], actions: ['open', 'choose'], questions: [q('menu_visibility', '哪些角色或状态能看到各菜单项？'), q('menu_action', '选中菜单项后执行什么操作？')] },
  { id: 'table_grid', label: '表格或数据网格', platforms: ['web', 'app'], examples: ['table', 'DataGrid', 'LazyColumn'], attributes: ['rows', 'columns', 'sort', 'selection', 'editing'], actions: ['sort', 'select_row', 'edit_cell'], questions: [q('table_scope', '每行代表什么对象，唯一标识是什么？'), q('table_sort', '排序、筛选和行内编辑规则是什么？'), q('table_empty', '加载、空态和错误态如何显示？')] },
  { id: 'list_card', label: '列表或卡片', platforms: ['web', 'app'], examples: ['list', 'RecyclerView', 'UICollectionView'], attributes: ['item_key', 'loading', 'empty_state'], actions: ['open_item', 'select', 'refresh'], questions: [q('list_item', '每项对应哪个业务对象？'), q('list_refresh', '何时刷新，空态如何显示？')] },
  { id: 'tree', label: '树与层级选择', platforms: ['web', 'app'], examples: ['role=tree', 'TreeView', 'OutlineGroup'], attributes: ['parent', 'children', 'selected', 'expanded'], actions: ['expand', 'select', 'move'], questions: [q('tree_linkage', '父子选中与展开如何联动？'), q('tree_load', '子节点何时加载？', ['预加载', '展开时加载', '暂未确定'])] },
  { id: 'pagination', label: '分页与无限滚动', platforms: ['web', 'app'], examples: ['Pagination', 'LazyList', 'InfiniteScroll'], attributes: ['page', 'page_size', 'total', 'cursor'], actions: ['next', 'previous', 'load_more'], questions: [q('page_mode', '页码、游标还是无限加载？', ['页码', '游标', '无限加载', '暂未确定']), q('page_reset', '筛选变化后是否回到第一页？', yn)] },
  { id: 'drag_drop', label: '拖拽排序或移动', platforms: ['web', 'app'], examples: ['draggable', 'ReorderableList', 'UIDragInteraction'], attributes: ['source', 'target', 'order', 'undo'], actions: ['drag', 'drop', 'cancel'], questions: [q('drag_target', '允许从哪里拖到哪里？'), q('drag_save', '松手即保存还是确认后保存？', ['松手即保存', '确认后保存', '暂未确定']), q('drag_undo', '失败或撤销时如何恢复？')] },
  { id: 'media', label: '音视频或图片预览', platforms: ['web', 'app'], examples: ['audio/video', 'MediaPlayer', 'AVPlayer'], attributes: ['source', 'permissions', 'duration', 'download'], actions: ['play', 'pause', 'seek'], questions: [q('media_source', '媒体资源从哪里来，何时可访问？'), q('media_failure', '加载失败或无权限如何呈现？')] },
  { id: 'status_feedback', label: '提示与进度反馈', platforms: ['web', 'app'], examples: ['Toast', 'Snackbar', 'Alert', 'ProgressIndicator'], attributes: ['message', 'severity', 'duration', 'dismiss', 'progress'], actions: ['show', 'dismiss', 'retry'], questions: [q('feedback_trigger', '什么条件触发提示？'), q('feedback_duration', '何时消失，能否手动关闭？'), q('feedback_retry', '失败提示是否提供重试？')] },
  { id: 'map_location', label: '地图与定位', platforms: ['web', 'app'], examples: ['MapView', 'GoogleMap', 'MapKit'], attributes: ['coordinates', 'permission', 'precision'], actions: ['locate', 'pan', 'select_pin'], questions: [q('location_permission', '未授权或定位失败如何处理？'), q('location_precision', '坐标精度与更新频率是多少？')] },
  { id: 'gesture', label: '手势交互', platforms: ['app'], examples: ['Swipe', 'LongPress', 'Pinch', 'PullToRefresh'], attributes: ['gesture', 'threshold', 'conflict'], actions: ['swipe', 'long_press', 'pinch', 'refresh'], questions: [q('gesture_target', '手势作用于哪个对象？'), q('gesture_conflict', '与滚动、点击冲突时如何处理？'), q('gesture_feedback', '触发后有什么可见反馈？')] },
  { id: 'system_permission', label: '系统权限或能力', platforms: ['app'], examples: ['CameraPermission', 'NotificationPermission', 'Biometrics'], attributes: ['authorization', 'denied', 'settings'], actions: ['request', 'grant', 'deny'], questions: [q('permission_timing', '什么时候请求系统权限？'), q('permission_denied', '拒绝或永久拒绝后如何继续？')] },
];

const byId = new Map(COMPONENTS.map((item) => [item.id, item]));
export function componentById(id) { return byId.get(id) || null; }

export function classifyComponent(operation) {
  const tag = String(operation?.tag || '').toLowerCase();
  const type = String(operation?.anchor?.type || operation?.latest_runtime?.type || '').toLowerCase();
  const role = String(operation?.anchor?.role || '').toLowerCase();
  const click = String(operation?.anchor?.onclick || '');
  const label = String(operation?.label || '');
  const data = operation?.anchor?.data || {};
  const className = String(operation?.anchor?.class_name || '').toLowerCase();
  let id = '';
  let evidence = '';
  if (tag === 'textarea' || tag === 'input' && /^(text|email|tel|url|password|)$/.test(type)) { id = 'text_input'; evidence = `input:${type || 'text'}`; }
  else if (tag === 'input' && type === 'number') { id = 'number_input'; evidence = 'input:number'; }
  else if (tag === 'input' && /^(date|time|datetime-local|month|week)$/.test(type)) { id = 'date_time'; evidence = `input:${type}`; }
  else if (tag === 'input' && type === 'file') { id = 'file_upload'; evidence = 'input:file'; }
  else if (tag === 'input' && type === 'range' || role === 'slider') { id = 'slider'; evidence = 'range/slider'; }
  else if (tag === 'input' && type === 'search' || /^(search|filter)\w*\s*\(/i.test(click)) { id = 'search_filter'; evidence = 'search handler'; }
  else if (tag === 'input' && type === 'radio' || role === 'radio') { id = 'radio_group'; evidence = 'radio'; }
  else if (role === 'switch') { id = 'switch'; evidence = 'role=switch'; }
  else if (tag === 'input' && type === 'checkbox' || role === 'checkbox') { id = 'checkbox'; evidence = 'checkbox'; }
  else if (tag === 'select' && operation?.anchor?.multiple || role === 'listbox' && operation?.anchor?.multiple) { id = 'multi_select'; evidence = 'multiple selection'; }
  else if (tag === 'select' || role === 'combobox' || /custom-select|dropdown|cascader/.test(className) || /CustomSelect\.(?:toggle|open)\s*\(|select(?=[A-Z]|\b)|dropdown|picker|请选择|下拉|toggleRegionPanel\s*\(/i.test(`${click} ${label}`)) { id = 'single_select'; evidence = 'select/combobox'; }
  else if (role === 'tab' || Object.keys(data).some((key) => /(?:^|-)tab$/.test(key)) || /^switch\w*Tab\s*\(/.test(click)) { id = 'tab'; evidence = 'tab'; }
  else if ((tag === 'a' || /(?:^|\s)(?:inner-tab|nav-tab)(?:\s|$)/.test(className)) && /(?:location\.(?:href|assign|replace)|window\.location)\s*(?:=|\()/.test(click)) { id = 'navigation'; evidence = 'scripted page navigation'; }
  else if (tag === 'summary' || role === 'button' && operation?.anchor?.expanded || /accordion|disclosure/.test(className) || /toggle\w*(?:Details|Menu|Expand|Section|Card|Sub)\s*\(/.test(click) || Object.keys(data).some((key) => /menu-count$/.test(key))) { id = 'disclosure'; evidence = 'expand/collapse'; }
  else if (/^(show|open|hide|close)\w*(?:Modal|Dialog|Drawer)\s*\(/i.test(click) || /(?:modal|dialog|drawer)-close/.test(className)) { id = 'dialog'; evidence = 'dialog action'; }
  else if (tag === 'a' && operation?.anchor?.download || /^(download|export)\w*\s*\(/i.test(click)) { id = 'download_action'; evidence = 'download/export'; }
  else if (role === 'menuitem' || role === 'menu') { id = 'menu'; evidence = 'menu role'; }
  else if (role === 'treeitem' || role === 'tree') { id = 'tree'; evidence = 'tree role'; }
  else if (role === 'gridcell' || role === 'grid' || tag === 'table') { id = 'table_grid'; evidence = 'grid/table'; }
  else if (tag === 'a' && operation?.anchor?.href) { id = 'navigation'; evidence = 'link href'; }
  else if (tag === 'input' && type === 'submit' || operation?.trigger === 'submit' || /^(submit|save|confirm|delete)\w*\s*\(/i.test(click) || /^(保存|提交|确认删除|删除)$/.test(label)) { id = 'submit_action'; evidence = 'submit action'; }
  else if (tag === 'button' || role === 'button' && !click) { id = 'button_action'; evidence = 'button'; }
  const family = componentById(id);
  // Operations keep only the match. Question templates live once in the catalogue.
  return family ? { id, status: 'matched', evidence } : { id: 'unmatched', status: 'needs_research', evidence: `${tag}|${role}|${type}|${click.slice(0, 70)}` };
}

export function componentCoverageMarkdown(operations, unmatched, snapshotId) {
  const counts = new Map();
  for (const item of operations) counts.set(item.component?.id || 'unmatched', (counts.get(item.component?.id || 'unmatched') || 0) + 1);
  const families = [...counts].sort((a, b) => b[1] - a[1]).map(([id, count]) => `| ${componentById(id)?.label || '未匹配'} | ${count} |`).join('\n');
  const queue = unmatched.map((item) => `| ${item.count} | ${item.signature.replaceAll('|', '\\|')} | ${item.example.label.replaceAll('|', '\\|')} | ${item.example.source ? `${item.example.source.path}:${item.example.source.line}` : '运行时'} |`).join('\n');
  return `# Prototype Talk · 组件覆盖\n\n源码快照：${snapshotId}；组件目录版本：${CATALOG_VERSION}。未匹配项按签名去重，首次处理时研究其真实组件属性，再更新 Skill；这里的签名不是业务规则。\n\n## 已匹配组件族\n\n| 组件族 | 控件数 |\n| --- | ---: |\n${families}\n\n## 待研究签名\n\n| 出现次数 | 签名 | 示例标签 | 首次位置 |\n| ---: | --- | --- | --- |\n${queue || '| 0 | 暂无 | | |'}\n`;
}
