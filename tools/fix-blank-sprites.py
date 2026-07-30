#!/usr/bin/env python3
"""
Repair blank (fully transparent) canvases in converted WZ JSON files.

The original wz-to-json conversion silently produced zeroed pixel data for
some images (failed inflate on chunk-encrypted picture data). This script
finds those blank canvases and re-fetches the real pixels from the
maplestory.io raw WZ API (GMS v83), patching basedata in place.

Usage: python3 tools/fix-blank-sprites.py <wz_dir_name> [--dry-run]
  e.g. python3 tools/fix-blank-sprites.py Mob.wz
"""
import json, base64, glob, os, struct, sys, time, urllib.request, urllib.parse

ROOT = os.path.join(os.path.dirname(__file__), '..', 'TypeScript-Client', 'public', 'wz_client')
API = 'https://maplestory.io/api/wz/GMS/83'

def png_dims(data: bytes):
    if len(data) < 24 or data[:8] != b'\x89PNG\r\n\x1a\n':
        return None
    return struct.unpack('>II', data[16:24])

def find_blanks(doc):
    """Yield (canvas_node, wz_path) for blank canvases."""
    out = []
    def walk(n, p):
        for c in n.get('$$', []):
            nm = c.get('$imgdir') or c.get('$canvas')
            if nm is None:
                continue
            path = f'{p}/{nm}' if p else str(nm)
            if '$canvas' in c and c.get('basedata'):
                w = int(c.get('width') or 0)
                h = int(c.get('height') or 0)
                if w * h >= 64 and len(c['basedata']) < 200:
                    out.append((c, path))
            walk(c, path)
    walk(doc, '')
    return out

def fetch_node(img_name, node_path):
    url = f'{API}/{urllib.parse.quote(img_name)}/{urllib.parse.quote(node_path)}'
    req = urllib.request.Request(url, headers={'User-Agent': 'maple-origin sprite repair'})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)

def main():
    wz_dir = sys.argv[1] if len(sys.argv) > 1 else 'Mob.wz'
    dry = '--dry-run' in sys.argv
    files = sorted(glob.glob(os.path.join(ROOT, wz_dir, '**', '*.img.json'), recursive=True))
    patched = failed = mismatched = 0
    failures = []

    for f in files:
        with open(f, encoding='utf-8') as fh:
            doc = json.load(fh)
        blanks = find_blanks(doc)
        if not blanks:
            continue
        # e.g. "Character.wz/Cap/01002140.img.json" -> API path "Character/Cap/01002140.img"
        rel = os.path.relpath(f, ROOT)[:-5]  # strip ".json"
        img_name = rel.replace('.wz' + os.sep, '/').replace(os.sep, '/')
        changed = False
        for node, path in blanks:
            try:
                api = fetch_node(img_name, path)
                val = api.get('value')
                if not isinstance(val, str) or len(val) < 100:
                    raise ValueError(f'no image value ({str(val)[:40]})')
                data = base64.b64decode(val)
                dims = png_dims(data)
                want = (int(node.get('width') or 0), int(node.get('height') or 0))
                if dims != want:
                    mismatched += 1
                    failures.append(f'{img_name}/{path}: size {dims} != {want}')
                    continue
                node['basedata'] = val
                patched += 1
                changed = True
            except Exception as e:
                failed += 1
                failures.append(f'{img_name}/{path}: {e}')
            time.sleep(0.08)  # be polite to the API
        if changed and not dry:
            with open(f, 'w', encoding='utf-8') as fh:
                json.dump(doc, fh, ensure_ascii=False, separators=(',', ':'))
        print(f'{os.path.basename(f)}: {len(blanks)} blanks -> patched so far {patched}', flush=True)

    print(f'\nDone. patched={patched} failed={failed} size-mismatch={mismatched}')
    for line in failures[:40]:
        print('  !', line)

if __name__ == '__main__':
    main()
