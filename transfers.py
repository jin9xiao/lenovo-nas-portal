from __future__ import print_function

import base64
import binascii
import json
import os
import re
import stat
try:
    from urllib import urlencode, quote
    from urlparse import urlsplit
except ImportError:
    from urllib.parse import urlencode, quote, urlsplit

from native import APIError, opener

ROOT = '/sata/download/complete'
ARIA = 'http://127.0.0.1:6800/jsonrpc'
QBT = 'http://127.0.0.1:8080/api/v2/torrents/'


def fetch(url, body=None, mime=None):
    from native import Request
    response = opener.open(Request(url, body, {'Content-Type': mime} if mime else {}), timeout=3)
    try:
        data = response.read(1024 * 1024 + 1)
        if len(data) > 1024 * 1024:
            raise APIError(502)
        return data
    finally:
        response.close()


def aria(method, args):
    payload = {'jsonrpc': '2.0', 'id': 'portal', 'method': 'aria2.' + method, 'params': args}
    response = json.loads(fetch(ARIA, json.dumps(payload).encode('ascii'), 'application/json'))
    if 'result' not in response:
        raise APIError(409)
    return response['result']


def qbt(method, data):
    return fetch(QBT + method, urlencode(data).encode('ascii'), 'application/x-www-form-urlencoded')


def list_tasks(engine):
    if engine == 'aria2':
        keys = ['gid', 'status', 'totalLength', 'completedLength', 'downloadSpeed', 'errorCode', 'files']
        rows = aria('tellActive', [keys]) + aria('tellWaiting', [0, 50, keys]) + aria('tellStopped', [0, 50, keys])
        return [{'id': row['gid'], 'state': row['status'],
                 'name': os.path.basename((row.get('files') or [{}])[0].get('path') or '') or row['gid'],
                 'total': row.get('totalLength'), 'done': row.get('completedLength'),
                 'speed': row.get('downloadSpeed'), 'error': row.get('errorCode')} for row in rows]
    if engine == 'bt':
        rows = json.loads(fetch(QBT + 'info?limit=100'))
        return [{'id': r['hash'], 'name': r['name'], 'state': r['state'],
                 'total': r['total_size'], 'done': r.get('completed'), 'speed': r['dlspeed']} for r in rows]
    raise APIError(400)


def control(engine, action, task):
    if action not in ('pause', 'resume', 'remove', 'retry') or not isinstance(task, type(u'')):
        raise APIError(400)
    if engine == 'aria2' and re.match(r'^[0-9a-f]{16}\Z', task):
        if action == 'remove':
            row = aria('tellStatus', [task, ['status']])
            aria('removeDownloadResult' if row['status'] in ('error','complete','removed') else 'remove', [task])
        elif action == 'retry':
            row = aria('tellStatus', [task, ['status','files']])
            uris = (row.get('files') or [{}])[0].get('uris') or []
            if row['status'] != 'error' or not uris:
                raise APIError(409)
            add(engine, {'url':uris[0]['uri']})
        else:
            aria('pause' if action == 'pause' else 'unpause', [task])
    elif engine == 'bt' and re.match(r'^[0-9a-f]{40}\Z', task):
        data = {'hashes':task}
        if action == 'remove':
            data['deleteFiles'] = 'false'
        qbt({'pause':'pause','resume':'resume','remove':'delete','retry':'recheck'}[action], data)
    else:
        raise APIError(400)


def add(engine, body):
    if engine == 'bt' and 'torrent' in body:
        raw = base64.b64decode(body['torrent'])
        if not raw.startswith(b'd') or not raw.endswith(b'e') or len(raw) > 512 * 1024:
            raise APIError(400)
        boundary = 'Portal' + binascii.hexlify(os.urandom(12)).decode('ascii')
        form = ('--' + boundary + '\r\nContent-Disposition: form-data; name="torrents"; '
                'filename="download.torrent"\r\nContent-Type: application/x-bittorrent\r\n\r\n').encode('ascii')
        end = ('\r\n--' + boundary + '--\r\n').encode('ascii')
        result = fetch(QBT + 'add', form + raw + end, 'multipart/form-data; boundary=' + boundary)
        if result.strip() != b'Ok.':
            raise APIError(409)
        return {}
    url = body['url'].strip()
    if not isinstance(url, type(u'')) or not 0 < len(url) <= 3000 or any(ord(c) < 33 or ord(c) > 126 for c in url):
        raise APIError(400)
    if engine == 'aria2':
        parsed = urlsplit(url)
        if parsed.scheme not in ('http', 'https') or not parsed.hostname or parsed.username or parsed.password:
            raise APIError(400)
        return {'id': aria('addUri', [[url], {
            'dir': ROOT, 'allow-overwrite': 'false', 'auto-file-renaming': 'true',
            'check-certificate': 'true', 'ca-certificate': '/etc/ssl/certs/ca-certificates.crt'}])}
    if engine == 'bt' and re.match(r'^magnet:\?xt=urn:btih:(?:[a-fA-F0-9]{40}|[A-Za-z2-7]{32})(?:&|\Z)', url):
        if qbt('add', {'urls': url}).strip() != b'Ok.':
            raise APIError(409)
        return {}
    raise APIError(400)


def library(path, root=ROOT):
    if not os.path.ismount('/sata'):
        raise APIError(503)
    if not isinstance(path, type(u'')) or len(path) > 2000:
        raise APIError(400)
    parts = path.split('/') if path else []
    if any(not p or p.startswith('.') or '\x00' in p or '\\' in p for p in parts):
        raise APIError(400)
    target = root
    for part in parts:
        target = os.path.join(target, part.encode('utf-8') if str is bytes else part)
        if os.path.islink(target):
            raise APIError(404)
    if os.path.realpath(root) != root:
        raise APIError(404)
    return target


def files(path, root=ROOT):
    target = library(path, root)
    if not os.path.isdir(target):
        if not path and root != ROOT:
            return []
        raise APIError(404)
    result = []
    verified = None
    for name in sorted(os.listdir(target))[:500]:
        try:
            label = name.decode('utf-8') if isinstance(name, bytes) else name
            if label.startswith('.') or label.endswith(('.aria2', '.!qB')) or '\\' in label:
                continue
            full = os.path.join(target, name)
            info = os.lstat(full)
            if stat.S_ISREG(info.st_mode) and os.path.exists(full + '.aria2'):
                if verified is None:
                    verified = completed_aria_paths()
                if full not in verified:
                    continue
            if stat.S_ISDIR(info.st_mode) or (stat.S_ISREG(info.st_mode) and info.st_nlink == 1
                                              ):
                result.append({'name': label, 'dir': stat.S_ISDIR(info.st_mode), 'size': info.st_size})
        except (IOError, OSError, UnicodeError):
            continue
    return result


def completed_aria_paths():
    try:
        rows = aria('tellStopped', [0, 50, ['status', 'files']])
        return set(os.path.normpath(f['path'].encode('utf-8') if str is bytes else f['path'])
                   for row in rows if row['status'] == 'complete' for f in row.get('files', [])
                   if f.get('path') and f.get('selected') == 'true'
                   and f.get('completedLength') == f.get('length'))
    except (APIError, IOError, ValueError, KeyError):
        return set()


def file_redirect(path, root=ROOT):
    target = library(path, root)
    try:
        info = os.lstat(target)
    except OSError:
        raise APIError(404)
    if (not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or path.endswith(('.aria2', '.!qB'))
            or (os.path.exists(target + '.aria2') and target not in completed_aria_paths())):
        raise APIError(404)
    if root == ROOT:
        return '/_portal_completed/' + quote(path.encode('utf-8'), safe='/')
    return '/_portal_baidu/' + quote(target[len('/sata/home/'):], safe='/')
