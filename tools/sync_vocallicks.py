"""Copy the shared engine files from a Vocallicks checkout, then run the tests.
Usage: python3 tools/sync_vocallicks.py ../vocallicks"""
import pathlib, shutil, subprocess, sys
root = pathlib.Path(__file__).resolve().parent.parent
src = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else root.parent / "vocallicks").resolve()
for f in ["js/theory.js", "js/data.js"]:
    shutil.copyfile(src / f, root / f)
    print("copied", f)
sys.exit(subprocess.call(["node", str(root / "tests/music.test.js")]))
