# -*- coding: utf-8 -*-
"""解压 zip 到目标目录；若压缩包内存在唯一顶层目录，则自动去掉该层。"""
import sys, os, zipfile

def main():
    if len(sys.argv) < 3:
        print("usage: unzip.py <src.zip> <dst_dir>")
        return 2
    src, dst = sys.argv[1], sys.argv[2]
    dst = os.path.abspath(dst)
    os.makedirs(dst, exist_ok=True)

    with zipfile.ZipFile(src) as z:
        names = z.namelist()
        tops = set()
        for n in names:
            parts = n.replace('\\', '/').split('/')
        # 重新统计顶层目录
        for n in names:
            p = n.replace('\\', '/')
            if p.endswith('/'):
                p = p[:-1]
            first = p.split('/')[0]
            tops.add(first)
        prefix = ''
        if len(tops) == 1:
            t = list(tops)[0]
            if t:
                prefix = t + '/'
        cnt = 0
        for n in names:
            p = n.replace('\\', '/')
            if p.endswith('/'):
                continue
            target = p[len(prefix):] if (prefix and p.startswith(prefix)) else p
            if not target:
                continue
            out = os.path.join(dst, *target.split('/'))
            d = os.path.dirname(out)
            if d:
                os.makedirs(d, exist_ok=True)
            try:
                with z.open(n) as f, open(out, 'wb') as o:
                    while True:
                        chunk = f.read(1024 * 512)
                        if not chunk:
                            break
                        o.write(chunk)
                cnt += 1
            except Exception as e:
                print("SKIP", n, e)
    print("EXTRACTED", cnt)
    return 0

sys.exit(main())
