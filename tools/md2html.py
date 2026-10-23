#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""极简 Markdown -> 单文件 HTML（支持标题/表格/列表/引用/代码/粗体/链接）。
生成的文件可直接双击打开，也可用浏览器「打印为 PDF」。"""
import re
import sys
import html as H

def inline(s):
    s = H.escape(s)
    s = re.sub(r'\*\*(.+?)\*\*', r'<strong>\1</strong>', s)
    s = re.sub(r'`([^`]+)`', r'<code>\1</code>', s)
    s = re.sub(r'\[([^\]]+)\]\(([^)]+)\)', r'<a href="\2">\1</a>', s)
    return s

def convert(md):
    lines = md.split('\n')
    out, i = [], 0
    n = len(lines)
    while i < n:
        ln = lines[i]
        if not ln.strip():
            i += 1
            continue
        # 代码块
        if ln.startswith('```'):
            i += 1
            buf = []
            while i < n and not lines[i].startswith('```'):
                buf.append(H.escape(lines[i])); i += 1
            i += 1
            out.append('<pre><code>' + '\n'.join(buf) + '</code></pre>')
            continue
        # 标题
        m = re.match(r'^(#{1,6})\s+(.*)$', ln)
        if m:
            lv = len(m.group(1))
            out.append('<h%d>%s</h%d>' % (lv, inline(m.group(2)), lv))
            i += 1
            continue
        # 分隔线
        if re.match(r'^---+$', ln.strip()):
            out.append('<hr>')
            i += 1
            continue
        # 引用
        if ln.startswith('>'):
            buf = []
            while i < n and lines[i].startswith('>'):
                buf.append(inline(lines[i].lstrip('> ').rstrip())); i += 1
            out.append('<blockquote>' + '<br>'.join(buf) + '</blockquote>')
            continue
        # 表格
        if '|' in ln and i + 1 < n and re.match(r'^\s*\|?[\s:\-|]+\|[\s:\-|]*$', lines[i + 1]):
            header = [c.strip() for c in ln.strip().strip('|').split('|')]
            i += 2
            rows = []
            while i < n and '|' in lines[i] and lines[i].strip():
                rows.append([c.strip() for c in lines[i].strip().strip('|').split('|')]); i += 1
            t = ['<table><thead><tr>']
            for c in header:
                t.append('<th>' + inline(c) + '</th>')
            t.append('</tr></thead><tbody>')
            for r in rows:
                t.append('<tr>')
                for c in r:
                    t.append('<td>' + inline(c) + '</td>')
                t.append('</tr>')
            t.append('</tbody></table>')
            out.append(''.join(t))
            continue
        # 有序 / 无序列表
        if re.match(r'^\s*([-*]|\d+\.)\s+', ln):
            ordered = bool(re.match(r'^\s*\d+\.\s+', ln))
            tag = 'ol' if ordered else 'ul'
            buf = []
            while i < n and re.match(r'^\s*([-*]|\d+\.)\s+', lines[i]):
                item = re.sub(r'^\s*([-*]|\d+\.)\s+', '', lines[i])
                buf.append('<li>' + inline(item) + '</li>')
                i += 1
                # 列表项的续行
                while i < n and lines[i].startswith('  ') and not re.match(r'^\s*([-*]|\d+\.)\s+', lines[i]):
                    if buf:
                        buf[-1] = buf[-1][:-5] + ' ' + inline(lines[i].strip()) + '</li>'
                    i += 1
            out.append('<%s>%s</%s>' % (tag, ''.join(buf), tag))
            continue
        # 普通段落
        buf = []
        while i < n and lines[i].strip() and not re.match(r'^(#{1,6}\s|>|\s*([-*]|\d+\.)\s|```|---+$)', lines[i]):
            buf.append(inline(lines[i].strip())); i += 1
        out.append('<p>' + '<br>'.join(buf) + '</p>')
    return '\n'.join(out)

CSS = """
* { box-sizing: border-box; }
body { margin:0; background:#f5f5f5; color:#000;
  font:16px/1.75 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif; }
.page { max-width: 860px; margin: 0 auto; background:#fff; padding: 56px 64px 72px;
  border-left:1px solid #000; border-right:1px solid #000; min-height:100vh; }
h1 { font-size:30px; margin:0 0 6px; letter-spacing:.5px; border-bottom:4px solid #000; padding-bottom:14px; }
h2 { font-size:21px; margin:40px 0 12px; padding-left:10px; border-left:6px solid #000; }
h3 { font-size:17px; margin:26px 0 8px; }
p { margin:10px 0; }
ul,ol { margin:10px 0 10px 22px; padding:0; }
li { margin:5px 0; }
blockquote { margin:16px 0; padding:12px 16px; border-left:4px solid #000; background:#f2f2f2; }
table { border-collapse:collapse; width:100%; margin:14px 0; font-size:15px; }
th,td { border:1px solid #000; padding:7px 10px; text-align:left; vertical-align:top; }
th { background:#000; color:#fff; font-weight:700; }
tbody tr:nth-child(even) { background:#f7f7f7; }
code { background:#eee; border:1px solid #ccc; padding:1px 5px; font-size:14px;
  font-family:Consolas,"Courier New",monospace; }
pre { background:#111; color:#fff; padding:14px 16px; overflow:auto; }
pre code { background:none; border:none; color:#fff; }
hr { border:none; border-top:2px solid #000; margin:32px 0; }
strong { font-weight:800; }
a { color:#000; text-decoration:underline; }
@media print { body{background:#fff} .page{max-width:none;border:none;padding:0} h2{page-break-after:avoid} table{page-break-inside:avoid} }
@media (max-width: 700px) { .page{padding:28px 20px;border:none} body{font-size:15px} h1{font-size:24px} }
"""

def main():
    src, dst = sys.argv[1], sys.argv[2]
    with open(src, encoding='utf-8') as f:
        md = f.read()
    body = convert(md)
    doc = ('<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">'
           '<meta name="viewport" content="width=device-width,initial-scale=1">'
           '<title>赛事编排系统 · 使用说明</title><style>' + CSS + '</style></head>'
           '<body><div class="page">' + body + '</div></body></html>')
    with open(dst, 'w', encoding='utf-8') as f:
        f.write(doc)
    print('written:', dst, len(doc), 'bytes')

if __name__ == '__main__':
    main()
