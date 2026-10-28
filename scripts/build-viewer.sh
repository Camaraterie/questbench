#!/bin/sh
# Build the pinned Palanti/rs-world observer. WSL uses Linux storage for dependency performance.
set -eu
cd "$(dirname "$0")/.."
qb_root="$PWD"
viewer_root="${QB_VIEWER_SOURCE:-${XDG_CACHE_HOME:-$HOME/.cache}/questbench/rs-world-build}"
viewer_ref=7e4c9f711ba2f5a1f8e354c6083b8a471530383b
if [ ! -d "$viewer_root/.git" ]; then
  mkdir -p "$(dirname "$viewer_root")"
  git clone https://github.com/MaxBittker/rs-world.git "$viewer_root"
  git -C "$viewer_root" checkout "$viewer_ref"
fi
[ "$(git -C "$viewer_root" rev-parse HEAD)" = "$viewer_ref" ] || { echo 'Unexpected viewer revision' >&2; exit 1; }
# Undo our known adaptations before validating the pinned upstream patch.
python3 "$qb_root/studio/viewer/configure.py" restore "$viewer_root"
if git -C "$viewer_root" apply --check "$qb_root/studio/viewer/rs-world.patch" 2>/dev/null; then
  git -C "$viewer_root" apply --whitespace=nowarn "$qb_root/studio/viewer/rs-world.patch"
elif ! git -C "$viewer_root" apply --reverse --check "$qb_root/studio/viewer/rs-world.patch" 2>/dev/null; then
  echo 'Viewer patch differs; preserve source and inspect it before building.' >&2; exit 1
fi
# Local-only feed and interpolation for sampled authoritative positions.
python3 "$qb_root/studio/viewer/configure.py" apply "$viewer_root"
cd "$viewer_root"
bun install --ignore-scripts
CI=false GENERATE_SOURCEMAP=false PUBLIC_URL=/viewer bun run build
mkdir -p "$qb_root/vendor/viewer-build"
cp -R build/. "$qb_root/vendor/viewer-build/"
python3 - "$qb_root/vendor/viewer-cache" <<'PY'
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import urllib.request,json,sys
root=Path(sys.argv[1]); (root/'rs-sdk-289').mkdir(parents=True,exist_ok=True)
base='https://maxbittker.github.io/rs-world/caches/'
paths=['caches.json','rs-sdk-289/keys.json']+['rs-sdk-289/main_file_cache.'+s for s in ['dat','idx0','idx1','idx2','idx3','idx4']]
def download(path):
    dest=root/path
    if not dest.exists():
        with urllib.request.urlopen(base+path,timeout=90) as r: data=r.read(20_000_001)
        if len(data)>20_000_000: raise ValueError('Unexpected cache size')
        dest.write_bytes(data)
    return path,dest.stat().st_size
print(list(ThreadPoolExecutor(max_workers=3).map(download,paths)))
meta=json.loads((root/'caches.json').read_text())
if len(meta)!=1 or meta[0]['revision']!=289 or meta[0]['name']!='rs-sdk-289': raise ValueError('Unexpected cache revision')
PY
echo 'Observer renderer ready. Start Studio with bun run studio.'
