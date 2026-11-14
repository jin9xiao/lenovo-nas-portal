# -*- coding: utf-8 -*-
from __future__ import print_function

import binascii
import json
import os
import time
try:
    from urllib2 import Request, build_opener, ProxyHandler, HTTPRedirectHandler
except ImportError:
    from urllib.request import Request, build_opener, ProxyHandler, HTTPRedirectHandler


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


opener = build_opener(ProxyHandler({}), NoRedirect())
MAX_RESPONSE = 2 * 1024 * 1024
V1 = '/oneapi/v1/'
# Browser input never selects an upstream URL or method.
VIEWS = {
    'files': (V1 + 'file', 'list'),
    'search': (V1 + 'file', 'search'),
    'recent': (V1 + 'file', 'recent'),
    'photos': (V1 + 'file', 'timeline'),
    'shares': (V1 + 'share', 'list'),
    'disks': (V1 + 'sys', 'hdsmart'),
    'volumes': (V1 + 'sys', 'hdinfo'),
    'system': (V1 + 'sys', 'stat'),
    'firmware': (V1 + 'sys', 'getversion'),
    'apps': (V1 + 'app', 'list'),
    'users': (V1 + 'user', 'list'),
    'logs': ('/oneapi/log', 'list'),
    'mounts': (V1 + 'extfs', 'list'),
    'cameras': (V1 + 'camera', 'list'),
    'dlna': (V1 + 'app/dlna', 'status'),
    'clock': (V1 + 'app/clock', 'getSetting'),
    'led': (V1 + 'sys', 'led'),
}
SESSIONS = {}
ATTEMPTS = {}


class APIError(Exception):
    def __init__(self, status):
        self.status = status


def rpc(route, method, params, token=None):
    payload = {'method': method, 'params': params}
    if token:
        payload['session'] = token
    request = Request('http://127.0.0.1' + route, json.dumps(payload).encode('ascii'),
                      {'Content-Type': 'application/json'})
    response = opener.open(request, timeout=5)
    try:
        raw = response.read(MAX_RESPONSE + 1)
        if len(raw) > MAX_RESPONSE:
            raise APIError(502)
        return json.loads(raw)
    finally:
        response.close()


def login(username, password, peer):
    now = time.time()
    for key, expiry in list(ATTEMPTS.items()):
        if expiry < now:
            del ATTEMPTS[key]
    if peer in ATTEMPTS:
        raise APIError(429)
    ATTEMPTS[peer] = now + 3
    result = rpc(V1 + 'auth', 'login', {'loginame': username, 'password': password})
    data = result.get('data') or {}
    token = data.get('access_token')
    if not result.get('result') or not token:
        raise APIError(401)
    for key, record in list(SESSIONS.items()):
        if record[1] <= now:
            del SESSIONS[key]
    if len(SESSIONS) >= 64:
        del SESSIONS[min(SESSIONS, key=lambda k: SESSIONS[k][1])]
    sid = binascii.hexlify(os.urandom(32)).decode('ascii')
    admin = (data.get('user') or {}).get('admin') in (True, 1, '1')
    SESSIONS[sid] = (token, now + min(3600, max(1, int(data.get('at_expires_in') or 900))), admin)
    return sid


def fields(obj, keys):
    return {k: obj[k] for k in keys if k in obj} if isinstance(obj, dict) else {}


def project(view, data):
    if view in ('files', 'recent', 'search'):
        return dict(fields(data, ('page', 'pages', 'total')), items=[
            fields(row, ('name', 'path', 'type', 'size', 'time')) for row in (data.get('files') or [])])
    if view == 'photos':
        return {'items': [fields(row, ('time', 'count', 'path')) for row in (data or [])]}
    if view == 'shares':
        return dict(fields(data, ('page', 'has_more')), items=[
            fields(row, ('name', 'title', 'type', 'count', 'expire', 'ctime', 'status'))
            for row in (data.get('list') or [])])
    if view in ('apps', 'users', 'mounts', 'cameras'):
        keys = {'apps': ('name', 'pack', 'stat', 'type'),
                'users': ('nickname', 'username', 'admin'),
                'mounts': ('name', 'type', 'status', 'state'),
                'cameras': ('name', 'alias', 'status', 'state')}[view]
        return {'items': [fields(row, keys) for row in (data or [])]}
    if view == 'logs':
        return dict(fields(data, ('page', 'pages', 'total')), items=[
            fields(row, ('time', 'type', 'action', 'event', 'operation', 'username', 'cttime'))
            for row in (data.get('logs') or [])])
    if view == 'disks':
        return {'items': [dict(fields(row.get('smart'), (
            'Device_Model','Power_On_Hours','Temperature_Celsius','User_Capacity')),
            slot=row.get('slot')) for row in (data.get('hds') or [])]}
    if view == 'volumes':
        return {u'磁盘记录': len(data.get('hds') or [])}
    if view == 'system':
        return fields(data, ('cpu', 'mem', 'fan'))
    if view == 'clock':
        return fields(data, ('time_on', 'time_off', 'week'))
    return fields(data, ('state', 'brand', 'product', 'version', 'build', 'model'))


def session_record(sid, admin=False):
    record = SESSIONS.get(sid)
    if not record or record[1] <= time.time():
        SESSIONS.pop(sid, None)
        raise APIError(401)
    if admin and not record[2]:
        raise APIError(403)
    return record


def file_path(path):
    if (len(path) > 2048 or path.startswith('//') or '\\' in path or
            any(ord(c) < 32 for c in path) or any(p in ('.', '..') for p in path.split('/'))):
        raise APIError(400)
    return path


def view_data(view, query, sid):
    record = session_record(sid)
    params = {}
    if view in ('shares', 'logs') or (view in ('files', 'search') and 'page' in query):
        params['page'] = max(1, min(100000, int(query.get('page', ['1'])[0])))
    if view == 'files' and 'path' in query:
        path = file_path(query['path'][0])
        if path:
            params['path'] = path
    if view == 'search':
        pattern = query.get('q', [''])[0].strip()
        if not pattern or len(pattern) > 200:
            raise APIError(400)
        params['pattern'] = pattern
    route, method = VIEWS[view]
    result = rpc(route, method, params, record[0])
    if not result.get('result'):
        code = (result.get('error') or {}).get('code')
        if code == -40001:
            SESSIONS.pop(sid, None)
            raise APIError(401)
        raise APIError(403)
    return project(view, result.get('data'))
