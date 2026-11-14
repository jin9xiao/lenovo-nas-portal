'use strict';

// Entries indicate verified capabilities, not assumed API availability.
const groups = [
  ['文件与存储', [
    ['文件管理、上传与搜索', 'app', '个人目录和共享目录仍按原厂账号权限访问。'],
    ['公开分享与共享链接', 'app', '通过原厂 App 创建或管理分享链接。', 9535],
    ['保险箱、回收站与收藏', 'app', '保留个人空间的访问权限。'],
    ['磁盘容量', 'live', '在概览查看数据卷容量与剩余空间。'],
    ['磁盘健康与巡检', 'live', '查看巡检排程；SMART 详情仍由原厂 App 提供。'],
    ['外接磁盘与远程挂载', 'app', '在原厂 App 中查看或配置挂载。', 9538],
  ]],
  ['下载与网盘', [
    ['离线下载 · aria2', 'live', '添加 HTTP / HTTPS 链接，查看进度，暂停或继续任务。', 6800],
    ['BT 下载 · qBittorrent', 'live', '添加磁力链接或 BT 种子，查看进度，暂停或继续任务。', 8080],
    ['迅雷下载', 'app', '从下载中心进入原厂迅雷网页，使用迅雷账号登录并管理任务。', 5050],
    ['百度网盘', 'app', '沿用现有绑定，浏览网盘文件、下载到 NAS 并查看任务。', 9533],
    ['已下载文件', 'live', '浏览离线下载的已完成目录，将文件取回当前设备。'],
    ['天翼云盘', 'app', '通过原厂应用绑定网盘账号。'],
    ['Transmission', 'pending', '固件含代理路由；该服务尚未验证。', 9091],
  ]],
  ['相册、媒体与摄像头', [
    ['相册与智能相册', 'app', '涉及个人照片和相册权限。'],
    ['视频、音乐与媒体库', 'app', '浏览和播放仍使用原厂权限。', 9531],
    ['DLNA 媒体投放', 'service', '可用电视或播放器发现媒体服务。', 8200],
    ['摄像头', 'app', '通过原厂 App 管理摄像头与录像。', 9540],
  ]],
  ['共享协议与备份', [
    ['SMB 文件共享', 'service', '在文件管理器中使用 NAS 地址连接 SMB，沿用现有共享权限。', 445],
    ['WebDAV', 'service', '在 WebDAV 客户端中使用 NAS 地址和端口 5005，沿用原有凭据。', 5005],
    ['AFP / Netatalk', 'pending', '固件含应用组件；门户尚未验证服务。'],
    ['NFS / rsync', 'pending', '固件含启动脚本；共享和备份能力尚未验证。'],
    ['设备备份与恢复', 'app', '在原厂 App 中查看配置与任务。'],
    ['Syncthing', 'pending', '固件含应用组件；尚未验证同步操作。', 8384],
  ]],
  ['设备与应用', [
    ['运行状态', 'live', '在概览查看内存、负载与连续运行时间。'],
    ['固件版本', 'live', '查看当前设备型号、固件版本和构建号。'],
    ['账号、用户组与访问权限', 'app', '账号与共享权限通过原厂 App 管理。'],
    ['系统日志、网络与远程访问', 'app', '在原厂 App 中查看设备设置。'],
    ['定时开关机、指示灯与 UPS', 'app', '固件包含相关组件，具体项目以原厂 App 为准。'],
    ['应用中心与第三方应用', 'app', '固件包含应用中心及扩展组件。'],
    ['Docker', 'pending', '设备含 Docker 组件；当前没有接入容器管理。'],
  ]],
];

const labels = {live:'网页可看', app:'原厂 App', service:'服务状态', pending:'待验证'};
const workspace = (label, view, mode) => [
  label, '/manage.html?' + new URLSearchParams(mode ? {view, mode} : {view}),
];
const transfer = (label, mode) => workspace(label, 'transfers', mode);
const entrances = {
  '文件管理、上传与搜索': {note:'浏览和搜索文件；上传仍用原厂 App。', links:[
    workspace('打开文件', 'files'), workspace('搜索文件', 'search'), workspace('最近文件', 'recent'),
  ]},
  '公开分享与共享链接': {note:'查看现有分享记录；创建分享仍用原厂 App。', links:[workspace('打开分享记录', 'shares')]},
  '磁盘容量': {links:[['查看容量概览', '#storage'], workspace('打开存储卷', 'volumes')]},
  '磁盘健康与巡检': {links:[workspace('打开磁盘', 'disks')]},
  '外接磁盘与远程挂载': {note:'在网页查看挂载列表；配置仍用原厂 App。', links:[workspace('打开挂载', 'mounts')]},
  '离线下载 · aria2': {links:[transfer('打开链接下载', 'aria2')]},
  'BT 下载 · qBittorrent': {links:[transfer('打开磁力与种子', 'bt')]},
  '迅雷下载': {links:[transfer('打开迅雷下载', 'thunder')]},
  '百度网盘': {links:[transfer('打开百度网盘', 'baidu')]},
  '已下载文件': {links:[transfer('打开已下载文件', 'completed')]},
  '相册与智能相册': {note:'查看照片时间线统计；智能相册和播放尚未接入。', links:[workspace('打开照片时间线', 'photos')]},
  'DLNA 媒体投放': {links:[workspace('打开 DLNA', 'dlna')]},
  '摄像头': {note:'查看设备列表；实时画面和录像尚未接入。', links:[workspace('打开摄像头列表', 'cameras')]},
  '运行状态': {links:[workspace('打开系统状态', 'system')]},
  '固件版本': {links:[workspace('打开固件版本', 'firmware')]},
  '账号、用户组与访问权限': {note:'查看用户列表；账号和权限修改仍用原厂 App。', links:[workspace('打开用户列表', 'users')]},
  '系统日志、网络与远程访问': {note:'查看系统日志；修改网络设置仍用原厂 App。', links:[workspace('打开系统日志', 'logs')]},
  '应用中心与第三方应用': {note:'查看原厂应用与状态；启停和安装尚未接入。', links:[workspace('打开应用列表', 'apps')]},
  '定时开关机、指示灯与 UPS': {note:'查看定时开关机与指示灯状态；UPS 与设置修改尚未接入。', links:[
    workspace('查看开关机计划', 'clock'), workspace('查看指示灯', 'led'),
  ]},
};
const byId = id => document.getElementById(id);
const node = (tag, value, cls) => {
  const el = document.createElement(tag);
  if (value) el.textContent = value;
  if (cls) el.className = cls;
  return el;
};
let snapshot = null;
let inFlight = false;

function renderCatalog() {
  const query = byId('filter').value.trim().toLowerCase();
  const fragment = document.createDocumentFragment();
  for (const [name, features] of groups) {
    const list = node('ul');
    for (const [title, kind, note, port] of features) {
      const entry = entrances[title];
      if (![name, title, entry?.note || note, ...(entry?.links || []).map(([label]) => label)]
        .join(' ').toLowerCase().includes(query)) continue;
      const row = node('li');
      const portStatus = port && snapshot
        ? (snapshot.ports.includes(port) ? ' · 已监听' : ' · 未监听')
        : '';
      let detail = entry?.note || note;
      if (title === '磁盘健康与巡检' && snapshot) {
        const health = snapshot.health;
        detail = !health ? '暂未取得巡检排程。' : !health.enabled ? '自动巡检未启用。' :
          `排程记录：${new Date(health.next * 1000).toLocaleString('zh-CN', {timeZone:'Asia/Shanghai'})}。执行结果请在原厂 App 查看。`;
      }
      if (port === 8080 && snapshot) {
        const torrent = snapshot.torrent;
        detail = torrent ? `${note} 下载 ${format(torrent.dl_info_speed, 1024, 'KiB/s')} · 上传 ${format(torrent.up_info_speed, 1024, 'KiB/s')}` : note;
      }
      row.append(node('h4', title), node('span', (entry ? '授权区' : labels[kind]) + portStatus,
        kind === 'pending' ? 'tag pending' : 'tag'), node('p', detail));
      if (entry) {
        const links = node('div', '', 'views');
        for (const [label, href] of entry.links) {
          const access = node('a', label);
          access.href = href;
          links.append(access);
        }
        row.append(links);
      }
      list.append(row);
    }
    if (!list.children.length) continue;
    const group = node('section', '', 'group');
    group.append(node('h3', name), list);
    fragment.append(group);
  }
  byId('empty').hidden = Boolean(fragment.children.length);
  byId('catalog').replaceChildren(fragment);
}

function format(bytes, scale, unit) {
  return `${(bytes / scale).toLocaleString('zh-CN', {maximumFractionDigits: 2})} ${unit}`;
}

function renderStatus(data) {
  const tib = bytes => format(bytes, 1024 ** 4, 'TiB');
  const disk = byId('disk-meter');
  if (data && data.disk) {
    const [free, total] = data.disk;
    disk.value = Math.round(100 * (total - free) / total);
    byId('disk').textContent = `${disk.value}% · ${tib(total)}`;
    byId('disk-note').textContent = `可用 ${tib(free)} · 双盘线性卷，无冗余`;
  } else {
    disk.removeAttribute('value');
    byId('disk').textContent = '—';
    byId('disk-note').textContent = data ? '未检测到数据卷挂载' : '暂无设备数据';
  }
  byId('memory').textContent = data ? format(data.memory[0], 1024 ** 3, 'GiB') : '—';
  byId('load').textContent = data ? `系统负载 · ${data.load.join(' / ')}` : '系统负载 —';
  const tasks = data && data.downloads;
  byId('downloads').textContent = tasks ? `${tasks.numActive} 个进行中` : '—';
  byId('transfer').textContent = tasks
    ? `${tasks.numWaiting} 个排队 · ${format(tasks.downloadSpeed, 1024, 'KiB/s')}`
    : '暂未取得 aria2 状态';
}

async function refresh() {
  if (inFlight) return;
  inFlight = true;
  byId('refresh').disabled = true;
  try {
    const response = await fetch('/api/status', {cache: 'no-store'});
    if (!response.ok) throw new Error('status');
    snapshot = await response.json();
    const hours = Math.floor(snapshot.uptime / 3600);
    const stamp = new Date(snapshot.time * 1000).toLocaleTimeString('zh-CN', {timeZone:'Asia/Shanghai'});
    byId('connection').textContent = `设备在线 · 已运行 ${hours} 小时 · ${stamp} 更新`;
  } catch {
    snapshot = null;
    byId('connection').textContent = '暂时无法读取设备状态，请刷新重试。';
  } finally {
    renderStatus(snapshot);
    renderCatalog();
    inFlight = false;
    byId('refresh').disabled = false;
  }
}

function restoreFilter() {
  byId('filter').value = new URLSearchParams(location.search).get('q') || '';
  renderCatalog();
}
byId('filter').addEventListener('input', () => {
  const url = new URL(location.href);
  if (byId('filter').value.trim()) url.searchParams.set('q', byId('filter').value.trim());
  else url.searchParams.delete('q');
  history.replaceState(null, '', url);
  renderCatalog();
});
window.addEventListener('popstate', restoreFilter);
byId('refresh').addEventListener('click', refresh);
restoreFilter();
refresh();
