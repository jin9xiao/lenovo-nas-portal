from __future__ import print_function

import json
import os
import socket
import time
from native import APIError, SESSIONS, VIEWS, login, view_data, session_record, file_path
import transfers
import baidu
try:
    from BaseHTTPServer import BaseHTTPRequestHandler, HTTPServer
    from urllib2 import Request, build_opener, ProxyHandler
    from urlparse import urlsplit, parse_qs
    from urllib import urlencode
    from Cookie import SimpleCookie, CookieError
except ImportError:
    from http.server import BaseHTTPRequestHandler, HTTPServer
    from urllib.request import Request, build_opener, ProxyHandler
    from urllib.parse import urlsplit, parse_qs, urlencode
    from http.cookies import SimpleCookie, CookieError

socket.setdefaulttimeout(3)
opener = build_opener(ProxyHandler({}))
PORTAL_ORIGIN = None


def read(path):
    with open(path) as source:
        return source.read()


def listeners():
    ports = set()
    for protocol in ('tcp', 'tcp6'):
        for line in read('/proc/net/' + protocol).splitlines()[1:]:
            columns = line.split()
            if columns[3] == '0A':
                ports.add(int(columns[1].split(':')[1], 16))
    return sorted(ports.intersection(
        (22, 53, 80, 86, 139, 445, 2049, 3306, 5005, 5050, 6379, 6800,
         8005, 8080, 8200, 8384, 8588, 9091, 9531, 9533, 9535, 9538, 9540)))


def downloads():
    request = Request('http://127.0.0.1:6800/jsonrpc', json.dumps({
        'jsonrpc': '2.0', 'id': 'portal', 'method': 'aria2.getGlobalStat',
    }).encode('ascii'), {'Content-Type': 'application/json'})
    response = opener.open(request, timeout=2)
    try:
        stats = json.loads(response.read(8192))['result']
        return {key: int(stats[key]) for key in (
            'numActive', 'numWaiting', 'numStopped', 'downloadSpeed', 'uploadSpeed')}
    finally:
        response.close()


def snapshot():
    mem = dict((line.split(':')[0], int(line.split()[1]))
               for line in read('/proc/meminfo').splitlines())
    disk = os.statvfs('/sata')
    mounted = any(line.split()[1] == '/sata' for line in read('/proc/mounts').splitlines())
    ports = listeners()
    try:
        transfer = downloads() if 6800 in ports else None
    except (IOError, ValueError, KeyError):
        transfer = None
    torrent = None
    if 8080 in ports:
        try:
            response = opener.open('http://127.0.0.1:8080/api/v2/transfer/info', timeout=2)
            try:
                stats = json.loads(response.read(8192))
                torrent = {key: int(stats[key]) for key in ('dl_info_speed', 'up_info_speed')}
            finally:
                response.close()
        except (IOError, ValueError, KeyError):
            pass
    health = None
    try:
        schedule = json.loads(read('/opt/conf/health_range.json'))
        health = {'enabled': bool(schedule['active']), 'next': int(schedule['next_time'])}
    except (IOError, ValueError, KeyError):
        pass
    return {
        'time': int(time.time()), 'uptime': int(float(read('/proc/uptime').split()[0])),
        'load': read('/proc/loadavg').split()[:3], 'ports': ports,
        'memory': [mem['MemAvailable'] * 1024, mem['MemTotal'] * 1024],
        'disk': [disk.f_bavail * disk.f_frsize, disk.f_blocks * disk.f_frsize] if mounted else None,
        'downloads': transfer, 'torrent': torrent, 'health': health,
    }


class Handler(BaseHTTPRequestHandler):
    def reply(self, status, data, cookie=None):
        result = json.dumps(data).encode('ascii')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(result)))
        if cookie is not None:
            self.send_header('Set-Cookie', 'portal_session=' + cookie +
                             '; Path=/api/private/; Secure; HttpOnly; SameSite=Strict' +
                             ('' if cookie else '; Max-Age=0'))
        self.end_headers()
        self.wfile.write(result)

    def cookie(self, name):
        try:
            cookie = SimpleCookie(self.headers.get('Cookie', ''))
            return cookie[name].value if name in cookie else ''
        except CookieError:
            return ''

    def session(self):
        return self.cookie('portal_session')

    def do_POST(self):
        if not PORTAL_ORIGIN or self.headers.get('Origin') != PORTAL_ORIGIN:
            self.reply(403, {})
            return
        if self.path == '/api/private/baidu':
            try:
                token = session_record(self.session(), admin=True)[0]
                length = int(self.headers.get('Content-Length', '0'))
                if not 0 < length <= 4096 or self.headers.get('Content-Type') != 'application/json':
                    raise APIError(400)
                data = json.loads(self.rfile.read(length))
                baidu.download(data['path'], int(data['start']), data.get('ids', [data.get('id')]), token)
                self.reply(202, {})
            except APIError as exc:
                self.reply(exc.status, {})
            except (ValueError, TypeError, KeyError, AttributeError):
                self.reply(400, {})
            except IOError:
                self.reply(502, {})
            return
        if self.path == '/api/private/transfers':
            try:
                session_record(self.session(), admin=True)
                length = int(self.headers.get('Content-Length', '0'))
                if not 0 < length <= 710000 or self.headers.get('Content-Type') != 'application/json':
                    raise APIError(400)
                body = json.loads(self.rfile.read(length))
                if body['action'] == 'add':
                    if not os.path.ismount('/sata') or not os.path.isdir(transfers.ROOT):
                        raise APIError(503)
                    result = transfers.add(body['engine'], body)
                else:
                    transfers.control(body['engine'], body['action'], body['id'])
                    result = {}
                self.reply(200, result)
            except APIError as exc:
                self.reply(exc.status, {})
            except (ValueError, TypeError, KeyError, AttributeError):
                self.reply(400, {})
            except IOError:
                self.reply(502, {})
            return
        if self.path == '/api/private/logout':
            SESSIONS.pop(self.session(), None)
            self.reply(200, {}, '')
            return
        if self.path != '/api/private/login':
            self.reply(404, {})
            return
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= 4096 or self.headers.get('Content-Type') != 'application/json':
                raise APIError(400)
            body = json.loads(self.rfile.read(length))
            username, password = body['username'], body['password']
            if not isinstance(username, type(u'')) or not isinstance(password, type(u'')):
                raise APIError(400)
            if not 0 < len(username) <= 128 or not 0 < len(password) <= 1024:
                raise APIError(400)
            sid = login(username, password, self.headers.get('X-Portal-Peer', ''))
            self.reply(200, {}, sid)
        except APIError as exc:
            self.reply(exc.status, {})
        except (ValueError, TypeError, KeyError):
            self.reply(400, {})
        except IOError:
            self.reply(502, {})

    def do_GET(self):
        path = urlsplit(self.path)
        if path.path == '/api/private/file-content':
            try:
                token = session_record(self.session())[0]
                name = file_path(parse_qs(path.query).get('path', [''])[0])
                if not name or name.endswith('/'):
                    raise APIError(400)
                if not isinstance(name, bytes):
                    name = name.encode('utf-8')
                self.send_response(200)
                self.send_header('X-Accel-Redirect', '/_portal_native_file?' +
                                 urlencode({'path':name, 'session':token}))
                self.end_headers()
            except APIError as exc:
                self.reply(exc.status, {})
            return
        if path.path == '/api/private/baidu':
            try:
                token = session_record(self.session(), admin=True)[0]
                query = parse_qs(path.query)
                name = query.get('path', ['/'])[0]
                if isinstance(name, bytes):
                    name = name.decode('utf-8')
                self.reply(200, baidu.read(name, int(query.get('start', ['0'])[0]), token))
            except APIError as exc:
                self.reply(exc.status, {})
            except (IOError, ValueError, TypeError, KeyError):
                self.reply(502, {})
            return
        if path.path in ('/api/private/transfers', '/api/private/completed', '/api/private/download'):
            try:
                record = session_record(self.session(), admin=True)
                query = parse_qs(path.query)
                name = query.get('path', [''])[0]
                if isinstance(name, bytes):
                    name = name.decode('utf-8')
                if path.path.endswith('/transfers'):
                    self.reply(200, {'items': transfers.list_tasks(query.get('engine', ['aria2'])[0])})
                elif path.path.endswith('/completed'):
                    root = baidu.completed_root(record[0]) if query.get('source') == ['baidu'] else transfers.ROOT
                    self.reply(200, {'items': transfers.files(name, root)})
                else:
                    root = baidu.completed_root(record[0]) if query.get('source') == ['baidu'] else transfers.ROOT
                    redirect = transfers.file_redirect(name, root)
                    self.send_response(200)
                    self.send_header('X-Accel-Redirect', redirect)
                    self.end_headers()
            except APIError as exc:
                self.reply(exc.status, {})
            except (ValueError, TypeError, KeyError):
                self.reply(400, {})
            except IOError:
                self.reply(502, {})
            return
        if path.path.startswith('/api/private/'):
            view = path.path[len('/api/private/'):]
            if view not in VIEWS:
                self.reply(404, {})
                return
            try:
                self.reply(200, view_data(view, parse_qs(path.query), self.session()))
            except APIError as exc:
                self.reply(exc.status, {})
            except (IOError, ValueError, TypeError, KeyError):
                self.reply(502, {})
            return
        if self.path != '/api/status':
            self.send_error(404)
            return
        try:
            result = json.dumps(snapshot()).encode('ascii')
        except (IOError, ValueError, KeyError):
            self.send_error(503)
            return
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(result)))
        self.end_headers()
        self.wfile.write(result)

    def log_message(self, *args):
        pass


if __name__ == '__main__':
    PORTAL_ORIGIN = json.loads(read('/media/nas-portal/settings.json'))['origin']
    if os.geteuid() == 0:
        os.setgroups([])
        os.setgid(65534)
        os.setuid(65534)
    HTTPServer(('127.0.0.1', 19090), Handler).serve_forever()
