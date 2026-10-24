import json, pathlib, sys
ROOT = pathlib.Path("/home/sudodave/intentguard").resolve()
def write(items):
    for item in items:
        p = (ROOT / item["path"]).resolve()
        if not p.is_relative_to(ROOT) or p == ROOT or ".git" in p.parts:
            raise ValueError("path outside project")
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(item["content"], encoding="utf-8")
        print(item["path"])
if __name__ == "__main__":
    write(json.loads(sys.argv[1] if len(sys.argv) > 1 else sys.stdin.read()))
