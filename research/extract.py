import re, html, sys, io

def to_text(path):
    s = open(path, encoding='utf-8', errors='replace').read()
    s = re.sub(r'(?is)<(script|style|noscript|svg)[^>]*>.*?</\1>', '', s)
    s = html.unescape(re.sub(r'(?s)<[^>]+>', '\n', s))
    lines = [l.strip() for l in s.split('\n') if l.strip()]
    return lines

if __name__ == '__main__':
    lines = to_text(sys.argv[1])
    out = io.open(sys.argv[2], 'w', encoding='utf-8')
    out.write('\n'.join(lines))
    out.close()
    print(f'{len(lines)} lines -> {sys.argv[2]}')
