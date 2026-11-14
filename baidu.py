import json
import re
import ssl
try:
    from urllib import urlencode
    from urllib2 import HTTPSHandler
except ImportError:
    from urllib.parse import urlencode
    from urllib.request import HTTPSHandler
from native import APIError, rpc, build_opener, ProxyHandler, NoRedirect

ROUTE = '/oneapi/app/netdisk/baidu'


def native(method, params, token):
    result = rpc(ROUTE, method, params, token)
    if not result.get('result'):
        raise APIError(409)
    return result.get('data')


def browse(path, start, token):
    auth = native('auth', {}, token) or {}
    if not auth.get('access_token'):
        raise APIError(409)
    ctx = ssl.create_default_context(cafile='/etc/ssl/certs/ca-certificates.crt')
    client = build_opener(ProxyHandler({}), NoRedirect(), HTTPSHandler(context=ctx))
    params = {'method':'list', 'dir':path.encode('utf-8'), 'start':start,
              'limit':100, 'access_token':auth['access_token']}
    response = client.open('https://pan.baidu.com/rest/2.0/xpan/file?' + urlencode(params), timeout=6)
    try:
        result = json.loads(response.read(2 * 1024 * 1024))
    finally:
        response.close()
    if result.get('errno') != 0:
        raise APIError(409)
    return [{'id':str(r['fs_id']), 'name':r['server_filename'], 'path':r['path'],
             'dir':r['isdir'] == 1, 'size':r.get('size', 0)} for r in result.get('list', [])]


def read(path, start, token):
    if not path.startswith('/') or len(path) > 2048 or start < 0 or start > 1000000:
        raise APIError(400)
    tasks = native('list', {'type':2}, token) or []
    return {'items':browse(path, start, token), 'tasks':[
        {k:r[k] for k in ('name','size','length','status','state','speed','errno') if k in r}
        for r in tasks if isinstance(r, dict)]}


def download(path, start, identifiers, token):
    if not path.startswith('/') or len(path) > 2048 or not 0 <= start <= 1000000:
        raise APIError(400)
    if not isinstance(identifiers, list) or not 1 <= len(identifiers) <= 50:
        raise APIError(400)
    selected = set(identifiers)
    matches = [item for item in browse(path, start, token) if item['id'] in selected]
    if len(matches) != len(selected):
        raise APIError(404)
    native('download', {'to_dir':'/download/complete', 'files':[{
        'id':item['id'], 'path':item['path'], 'size':item['size'], 'type':1 if item['dir'] else 0}
        for item in matches]}, token)


def completed_root(token):
    auth = native('auth', {}, token) or {}
    uid = str(auth.get('uid', ''))
    if not re.match(r'^[0-9]{1,20}\Z', uid):
        raise APIError(409)
    return '/sata/home/' + uid + '/download/complete'
