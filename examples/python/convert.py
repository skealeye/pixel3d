"""Convert one pixel-art image to a 3D-print file through a running `px3d serve`."""
import argparse
import base64
import json
import re
from pathlib import Path
from urllib.parse import unquote

import requests


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("image", type=Path, help="PNG, JPEG, GIF or WebP file")
    ap.add_argument("preset", type=Path, nargs="?", help="preset JSON file (optional)")
    ap.add_argument("-o", "--out", type=Path, default=Path("."), help="output directory (default: .)")
    ap.add_argument("--url", default="http://127.0.0.1:7300", help="server URL (default: %(default)s)")
    args = ap.parse_args()

    files = {"image": (args.image.name, args.image.read_bytes())}
    if args.preset:
        files["preset"] = (args.preset.name, args.preset.read_bytes(), "application/json")
    res = requests.post(f"{args.url}/convert", files=files, timeout=300)
    if not res.ok:
        try:
            message = res.json().get("error", res.text)
        except ValueError:
            message = res.text
        print(f"Failed ({res.status_code}): {message}")
        return 1

    # filename comes from Content-Disposition: a .3mf/.stl, or a .zip when the preset makes two files
    disposition = res.headers["Content-Disposition"]
    utf8 = re.search(r"filename\*=UTF-8''([^;]+)", disposition)
    name = unquote(utf8.group(1)) if utf8 else re.search(r'filename="([^"]+)"', disposition).group(1)
    name = Path(name).name  # never write outside --out
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / name).write_bytes(res.content)
    report = json.loads(base64.b64decode(res.headers["X-Pixel3d-Report"]))
    for w in report["warnings"]:
        print(f"warning: {w}")
    print(f"Saved {args.out / name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
