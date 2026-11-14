'use strict';

const el = id => document.getElementById(id);
const views = {
  files:'文件', search:'搜索', recent:'最近文件', photos:'照片时间线', shares:'分享记录',
  disks:'磁盘', volumes:'存储卷', mounts:'挂载', system:'系统状态', firmware:'固件',
  apps:'应用中心', users:'用户', logs:'系统日志', cameras:'摄像头', dlna:'DLNA', transfers:'下载中心',
  clock:'定时开关机', led:'指示灯',
};
const labels = {
  username:'账号', nickname:'昵称', admin:'管理员', type:'类型', size:'大小', time:'时间',
  count:'数量', pack:'应用标识', stat:'状态', version:'版本', build:'构建', model:'型号',
  brand:'品牌', product:'产品', state:'状态', cpu:'处理器', mem:'内存', fan:'风扇',
  time_on:'开机时间', time_off:'关机时间', week:'重复日期', slot:'盘位',
  Device_Model:'硬盘型号', Power_On_Hours:'通电小时', Temperature_Celsius:'温度（°C）', User_Capacity:'容量',
};
let requestId = 0;
const home = new URL('/', location.href);
home.protocol = 'http:';
home.port = '9090';
el('home-link').href = home.href;

function confirmTaskRemoval(name) {
  const dialog = el('remove-task-dialog');
  if (typeof dialog.showModal !== 'function') {
    return Promise.resolve(window.confirm('移除此任务？已下载的文件会保留。'));
  }
  if (dialog.open) return Promise.resolve(false);
  el('remove-task-name').textContent = name;
  dialog.returnValue = '';
  dialog.showModal();
  return new Promise(resolve => {
    dialog.addEventListener('close', () => {
      const confirmed = dialog.returnValue === 'remove';
      dialog.returnValue = '';
      resolve(confirmed);
    }, {once:true});
  });
}

el('keep-task').addEventListener('click', () => el('remove-task-dialog').close());
el('remove-task').addEventListener('click', () => el('remove-task-dialog').close('remove'));

function element(tag, value) {
  const n = document.createElement(tag);
  n.textContent = value;
  return n;
}

function link(label, view, params = {}) {
  const n = element('a', label);
  n.href = '?' + new URLSearchParams({view, ...params});
  return n;
}

function pretty(key, value) {
  if (key === 'time' && typeof value === 'number' && value > 1000000000) {
    return new Date(value * 1000).toLocaleString('zh-CN');
  }
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (value && typeof value === 'object') return JSON.stringify(value);
  return String(value ?? '—');
}

function row(value, view) {
  const box = element('li', '');
  const title = value.name || value.title || value.nickname || value.alias || value.username;
  if (view === 'files' || view === 'recent' || view === 'search') {
    box.append(value.type === 'dir' && value.path
      ? link(title || '文件夹', 'files', {path:value.path})
      : element('strong', title || '未命名文件'));
    box.append(element('p', value.type === 'dir' ? '文件夹' :
      [value.type, Number.isFinite(value.size) ? `${value.size.toLocaleString('zh-CN')} B` : ''].filter(Boolean).join(' · ')));
    if (value.type !== 'dir' && value.path) {
      const download = element('a', '下载文件');
      download.href = '/api/private/file-content?' + new URLSearchParams({path:value.path});
      download.download = title || 'download';
      box.append(download);
    }
    return box;
  }
  if (title) box.append(element('strong', title));
  for (const [key, val] of Object.entries(value)) {
    if (val !== '' && val != null && val !== title && key !== 'path') {
      box.append(element('p', `${labels[key] || key}：${pretty(key, val)}`));
    }
  }
  return box;
}

async function api(name, payload) {
  const opts = {cache:'no-store'};
  if (payload) Object.assign(opts, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload)});
  const response = await fetch('/api/private/' + name, opts);
  if (!response.ok) throw response.status;
  return response.json();
}

function toggleSession(on) {
  el('login').hidden = on;
  el('workspace').hidden = !on;
  el('logout').hidden = !on;
}

async function load() {
  const id = ++requestId;
  const query = new URLSearchParams(location.search);
  const selected = query.get('view') || 'files';
  const view = Object.hasOwn(views, selected) ? selected : 'files';
  query.delete('view');
  el('views').replaceChildren(...Object.entries(views).map(([key, title]) => {
    const a = link(title, key);
    if (key === view) a.setAttribute('aria-current', 'page');
    return a;
  }));
  el('view-title').textContent = views[view];
  el('results').replaceChildren();
  el('pages').replaceChildren();
  el('folder').textContent = view === 'files' ? (query.get('path') || '全部文件') : '';
  if (view === 'files' && query.get('path')) {
    const parents = query.get('path').split('/').filter(Boolean).slice(0, -1);
    const prefix = query.get('path').startsWith('/') ? '/' : '';
    el('pages').append(link('返回上一级', 'files', parents.length ? {path:prefix + parents.join('/')} : {}));
  }
  el('search').hidden = view !== 'search';
  el('transfer-tools').hidden = view !== 'transfers';
  el('pattern').value = view === 'search' ? (query.get('q') || '') : '';
  const searchIdle = view === 'search' && !query.get('q');
  el('notice').textContent = '正在读取…';
  try {
    if (view === 'transfers') {
      await renderTransfers(query, id);
      return;
    }
    const data = await api(searchIdle ? 'firmware' : view + '?' + query);
    if (id !== requestId) return;
    toggleSession(true);
    el('notice').textContent = '';
    if (searchIdle) return;
    if (Array.isArray(data.items)) {
      const list = element('ul', '');
      list.className = 'record-list';
      for (const record of data.items) list.append(row(record, view));
      el('results').append(list.children.length ? list : element('p', '没有可显示的记录。'));
      const page = Number(data.page) || 1;
      for (const [label, next, visible] of [['上一页', page - 1, page > 1], ['下一页', page + 1, page < data.pages || data.has_more]]) {
        if (visible) el('pages').append(link(label, view, {...Object.fromEntries(query), page:next}));
      }
    } else {
      const list = element('ul', '');
      list.className = 'record-list';
      for (const [key, val] of Object.entries(data)) list.append(element('li', `${labels[key] || key}：${pretty(key, val)}`));
      el('results').append(list.children.length ? list : element('p', '没有可显示的记录。'));
    }
  } catch (status) {
    if (id !== requestId) return;
    if (status === 401) toggleSession(false);
    else if (status === 403) toggleSession(true);
    el('notice').textContent = status === 401 ? '请用联想个人云账号登录。' :
      status === 403 ? '该账号无法读取此功能，请检查原厂权限。' : '暂时无法读取 NAS，请刷新重试。';
  }
}

const states = {active:'下载中', waiting:'排队中', paused:'已暂停', complete:'已完成',
  error:'失败', removed:'已取消', downloading:'下载中', stalledDL:'等待连接',
  metaDL:'获取元数据', pausedDL:'已暂停', pausedUP:'已暂停', uploading:'做种中',
  stalledUP:'已完成', queuedDL:'排队中', queuedUP:'等待做种', missingFiles:'文件缺失'};
let transferMode = 'aria2';
const bytes = n => Number.isFinite(Number(n)) && n != null
  ? new Intl.NumberFormat('zh-CN', {maximumFractionDigits: 2}).format(Number(n) / 1048576) + ' MiB' : '—';

async function renderTransfers(query, id) {
  const mode = ['aria2', 'bt', 'completed', 'baidu', 'thunder'].includes(query.get('mode')) ? query.get('mode') : 'aria2';
  transferMode = mode;
  const path = query.get('path') || '';
  const source = query.get('source') === 'baidu' ? 'baidu' : '';
  el('transfer-nav').replaceChildren(...[['aria2','链接下载'],['bt','磁力与种子'],['completed','已下载文件'],['baidu','百度网盘'],['thunder','迅雷']].map(([key, label]) => {
    const a = link(label, 'transfers', {mode:key});
    if (key === mode) a.setAttribute('aria-current', 'page');
    return a;
  }));
  el('add-download').hidden = mode !== 'aria2' && mode !== 'bt';
  el('add-torrent').hidden = mode !== 'bt';
  el('download-label').textContent = mode === 'bt' ? '磁力链接' : 'HTTP / HTTPS 链接';
  if (mode === 'baidu' || mode === 'thunder') {
    await renderProvider(mode, query, id);
    return;
  }
  const data = await api(mode === 'completed' ? 'completed?' + new URLSearchParams({path, source}) : 'transfers?engine=' + mode);
  if (id !== requestId) return;
  toggleSession(true);
  el('notice').textContent = '';
  const list = element('ul', '');
  list.className = 'record-list';
  if (mode === 'completed') {
    const folders = element('nav', '');
    folders.className = 'views';
    folders.setAttribute('aria-label', '下载目录');
    folders.append(link('公共下载', 'transfers', {mode}), link('百度网盘下载', 'transfers', {mode, source:'baidu'}));
    el('transfer-results').replaceChildren(folders);
  }
  if (mode === 'completed' && path) {
    const parent = element('li', '');
    parent.append(link('返回上一级', 'transfers', {mode, source, path:path.split('/').slice(0,-1).join('/')}));
    list.append(parent);
  }
  for (const item of data.items) {
    const entry = element('li', '');
    if (mode === 'completed') {
      const child = path ? path + '/' + item.name : item.name;
      const file = item.dir ? link(item.name, 'transfers', {mode, source, path:child}) : element('a', item.name);
      if (!item.dir) file.href = '/api/private/download?' + new URLSearchParams({path:child, source});
      entry.append(file, element('p', item.dir ? '文件夹' : bytes(item.size)));
    } else {
      entry.append(element('strong', item.name));
      const pct = Number(item.total) > 0 ? Math.min(100, Math.floor(100 * Number(item.done) / Number(item.total))) + '% · ' : '';
      entry.append(element('p', `${states[item.state] || item.state} · ${pct}${bytes(item.done)} / ${bytes(item.total)} · ${bytes(item.speed)}/s${Number(item.error) ? ' · 错误码 ' + item.error : ''}`));
      const paused = ['paused','pausedDL','pausedUP'].includes(item.state);
      if (paused || ['active','waiting','downloading','metaDL','stalledDL','queuedDL','uploading','stalledUP','queuedUP'].includes(item.state)) {
        const button = element('button', paused ? '继续' : '暂停');
        button.type = 'button';
        button.addEventListener('click', () => transferAction(button, () => ({
          engine:mode, action:paused ? 'resume' : 'pause', id:item.id})));
        entry.append(button);
      }
      const actions = element('div', '');
      actions.className = 'views';
      for (const [action, label] of [
        ...(item.state === 'error' || item.state === 'missingFiles' ? [['retry', mode === 'bt' ? '重新校验' : '重新下载']] : []),
        ['remove', '移除任务'],
      ]) {
        const button = element('button', label);
        button.type = 'button';
        button.addEventListener('click', async () => {
          if (action === 'remove' && !await confirmTaskRemoval(item.name)) return;
          transferAction(button, () => ({engine:mode, action, id:item.id}));
        });
        actions.append(button);
      }
      entry.append(actions);
    }
    list.append(entry);
  }
  if (mode === 'completed') el('transfer-results').append(list);
  else el('transfer-results').replaceChildren(list);
  if (!data.items.length) el('transfer-results').append(element('p', mode === 'completed' ? '该目录暂无可下载文件。' : '暂无任务。'));
}

async function renderProvider(mode, query, id) {
  const path = query.get('path') || '/';
  const start = Number(query.get('start') || 0);
  const output = el('transfer-results');
  output.replaceChildren();
  const data = await api(mode === 'baidu' ? 'baidu?' + new URLSearchParams({path, start}) : 'transfers?engine=aria2');
  if (id !== requestId) return;
  toggleSession(true);
  el('notice').textContent = '';
  if (mode === 'thunder') {
    const a = element('a', '打开迅雷原厂页面');
    const thunder = new URL('/etm/', home);
    thunder.port = '';
    a.href = thunder.href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    output.append(element('p', '使用迅雷账号登录后，在原厂页面创建任务和查看进度。'), a);
    return;
  }
  output.append(element('p', '下载保存到 NAS 个人空间的 download/complete。'));
  output.append(link('打开百度网盘已下载文件', 'transfers', {mode:'completed', source:'baidu'}));
  const list = element('ul', '');
  list.className = 'record-list';
  if (path !== '/') {
    const li = element('li', '');
    li.append(link('返回上一级', 'transfers', {mode, path:path.split('/').slice(0,-1).join('/') || '/'}));
    list.append(li);
  }
  const selected = new Set();
  const submit = element('button', '下载所选项目');
  submit.type = 'button';
  submit.disabled = true;
  async function submitBaidu(ids, button) {
    button.disabled = true;
    el('transfer-message').textContent = '正在提交百度网盘任务…';
    try {
      await api('baidu', {path, start, ids});
      el('transfer-message').textContent = '任务已提交。可刷新列表查看进度。';
    } catch {
      el('transfer-message').textContent = '提交失败，请检查登录及百度网盘绑定。';
    } finally {
      button.disabled = false;
    }
  }
  submit.addEventListener('click', () => submitBaidu([...selected], submit));
  for (const file of data.items) {
    const li = element('li', '');
    const label = element('label', '');
    const checkbox = element('input', '');
    checkbox.type = 'checkbox';
    checkbox.addEventListener('change', () => {
      if (checkbox.checked && selected.size < 50) selected.add(file.id);
      else {
        selected.delete(file.id);
        checkbox.checked = false;
      }
      submit.disabled = !selected.size;
    });
    label.append(checkbox, document.createTextNode(' 选择 ' + file.name));
    li.append(label);
    if (file.dir) {
      li.append(link(file.name, 'transfers', {mode, path:file.path}));
    } else {
      li.append(element('strong', file.name), element('p', bytes(file.size)));
      const button = element('button', '下载到 NAS');
      button.type = 'button';
      button.addEventListener('click', () => submitBaidu([file.id], button));
      li.append(button);
    }
    list.append(li);
  }
  output.append(list);
  if (data.items.length) output.append(submit);
  if (!data.items.length) output.append(element('p', '没有可显示的文件。'));
  if (start > 0) output.append(link('上一页', 'transfers', {mode, path, start:Math.max(0,start-100)}));
  if (data.items.length === 100) output.append(link('下一页', 'transfers', {mode, path, start:start+100}));
  output.append(element('h3', '百度网盘任务'));
  const tasks = element('ul', '');
  tasks.className = 'record-list';
  for (const task of data.tasks) {
    const state = task.errno ? '失败（' + task.errno + '）' :
      task.status === 5 ? '已完成' : '状态 ' + task.status;
    tasks.append(element('li', [task.name || '未命名任务', state, bytes(task.length) + ' / ' + bytes(task.size)].join(' · ')));
  }
  output.append(tasks.children.length ? tasks : element('p', '暂无任务。'));
}

async function transferAction(button, payload, reset) {
  button.disabled = true;
  el('transfer-message').textContent = '正在提交…';
  try {
    await api('transfers', await payload());
    if (reset) reset();
    el('transfer-message').textContent = '已提交，正在刷新列表…';
    await load();
    el('transfer-message').textContent = '已提交。';
  } catch (status) {
    if (status === 401) toggleSession(false);
    el('transfer-message').textContent = ({
      400:'请检查链接或种子文件。', 401:'会话已过期，请重新登录。', 403:'需要 NAS 管理员权限。',
      409:'下载服务拒绝了任务，请检查链接或当前任务状态。', 503:'数据卷未挂载，请检查 NAS。',
    })[status] || '下载服务暂时无法响应。';
  } finally {
    button.disabled = false;
  }
}

el('add-download').addEventListener('submit', event => {
  event.preventDefault();
  const form = event.currentTarget;
  transferAction(form.querySelector('button'), () => ({
    engine:transferMode, action:'add', url:el('download-url').value.trim()}), () => form.reset());
});
el('add-torrent').addEventListener('submit', event => {
  event.preventDefault();
  const form = event.currentTarget;
  transferAction(form.querySelector('button'), async () => {
    const file = el('torrent-file').files[0];
    if (!file || file.size > 524288) throw 400;
    const torrent = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.onerror = () => reject(400);
      reader.readAsDataURL(file);
    });
    return {engine:'bt', action:'add', torrent};
  }, () => form.reset());
});
el('refresh-transfers').addEventListener('click', load);

el('login').addEventListener('submit', async event => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button');
  button.disabled = true;
  el('notice').textContent = '正在登录…';
  try {
    await api('login', {username:el('username').value.trim(), password:el('password').value});
    await load();
  } catch (status) {
    el('notice').textContent = status === 401 ? '账号或密码未通过 NAS 验证。' :
      status === 429 ? '请稍等几秒再试。' : '登录暂时不可用，请重试。';
    el('password').focus();
  } finally {
    el('password').value = '';
    button.disabled = false;
  }
});
el('logout').addEventListener('click', async () => {
  try {
    await api('logout', {});
    await load();
  } catch {
    el('notice').textContent = '退出失败，请重试。';
  }
});
el('search').addEventListener('submit', event => {
  event.preventDefault();
  location.href = link('', 'search', {q:el('pattern').value.trim()}).href;
});
load();
