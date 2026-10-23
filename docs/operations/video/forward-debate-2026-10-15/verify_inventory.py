"""Check every file in INVENTORY.json. Usage: python3 -I verify_inventory.py [--media DIR]
Repository files are relative to this folder; media files are under --media (default $ALETHICAL_MEDIA or ~/Movies/Alethical/forward-debate-2026)."""
import json,hashlib,os,sys,argparse
HERE=os.path.dirname(os.path.abspath(__file__))
ap=argparse.ArgumentParser(); ap.add_argument("--media",default=os.environ.get("ALETHICAL_MEDIA",os.path.expanduser("~/Movies/Alethical/forward-debate-2026"))); A=ap.parse_args()
inv=json.load(open(os.path.join(HERE,"INVENTORY.json")))
def sha(p):
    h=hashlib.sha256()
    with open(p,"rb") as f:
        for ch in iter(lambda: f.read(1<<20),b""): h.update(ch)
    return h.hexdigest()
bad=0
for e in inv["files"]:
    if e["store"] == "archive":
        print("ARCHIVE ",e["path"],"(Drive only; not part of default local restore)"); continue
    p=os.path.join(HERE,e["path"]) if e["store"]=="repo" else os.path.join(A.media,e["path"])
    if not os.path.exists(p): print("MISSING ",e["path"]); bad+=1; continue
    ok=sha(p)==e["sha256"] and os.path.getsize(p)==e["bytes"]; print("MATCH   " if ok else "MISMATCH",e["path"]); bad+=0 if ok else 1
print("all files match" if bad==0 else f"{bad} problem(s)"); sys.exit(1 if bad else 0)
