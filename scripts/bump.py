#!/usr/bin/env python3
"""Вдига версията на кеша в sw.js и в js/version.js (чете преди да пише)."""
import io, re, sys

with io.open('sw.js', encoding='utf-8') as f:
    sw = f.read()
m = re.search(r"obrazec19-v(\d+)", sw)
if not m:
    sys.exit('CACHE_NAME не е намерен в sw.js')
old_n = int(m.group(1))
new_n = old_n + 1
with io.open('sw.js', 'w', encoding='utf-8') as f:
    f.write(sw.replace('obrazec19-v%d' % old_n, 'obrazec19-v%d' % new_n))

with io.open('js/version.js', encoding='utf-8') as f:
    ver = f.read()
with io.open('js/version.js', 'w', encoding='utf-8') as f:
    f.write(re.sub(r"APP_VERSION = '\d+'", "APP_VERSION = '%d'" % new_n, ver))

print('v%d -> v%d' % (old_n, new_n))
