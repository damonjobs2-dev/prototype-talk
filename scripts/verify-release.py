#!/usr/bin/env python3
"""Build a clean Skill archive, then run it as a recipient would."""

import argparse
import json
import os
import queue
import re
import shutil
import subprocess
import tempfile
import threading
import time
import urllib.request
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile


ROOT = Path(__file__).resolve().parents[1]
PACKAGE = "prototype-talk"
NODE = os.environ.get("PROTOTYPE_TALK_NODE", "node")
ROOT_FILES = [".gitignore", "README.md", "LICENSE", "THIRD_PARTY_NOTICES.md"]
PACKAGE_DIRS = ["skills/prototype-talk", "scripts", ".github/workflows"]


def build_archive(output):
    files = [ROOT / name for name in ROOT_FILES]
    for directory in PACKAGE_DIRS:
        folder = ROOT / directory
        if folder.exists():
            files.extend(path for path in folder.rglob("*") if path.is_file())
    files = sorted(path for path in files if path.name != ".DS_Store" and "__pycache__" not in path.parts)
    output.parent.mkdir(parents=True, exist_ok=True)
    with ZipFile(output, "w", ZIP_DEFLATED) as archive:
        for path in files:
            archive.write(path, Path(PACKAGE) / path.relative_to(ROOT))
    return len(files)


def run_command(*args):
    result = subprocess.run(args, text=True, capture_output=True, timeout=15)
    if result.returncode:
        raise RuntimeError(f"{' '.join(map(str, args))} failed:\n{result.stdout}{result.stderr}")
    return result.stdout


def stop(process):
    if process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)
    if process.stdout:
        process.stdout.close()


def start_server(script, demo, mode="--index-only"):
    process = subprocess.Popen(
        [NODE, str(script), "--source", str(demo), "--port", "0", mode],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )
    lines = queue.Queue()
    threading.Thread(target=lambda: [lines.put(line) for line in process.stdout], daemon=True).start()
    seen = []
    deadline = time.monotonic() + 10
    try:
        while time.monotonic() < deadline:
            try:
                line = lines.get(timeout=0.2)
            except queue.Empty:
                if process.poll() is not None:
                    break
                continue
            seen.append(line)
            match = re.search(r"http://127\.0\.0\.1:\d+/", line)
            if match:
                return process, match.group()
        raise RuntimeError("viewer did not start:\n" + "".join(seen))
    except BaseException:
        stop(process)
        raise


def check_http(base_url):
    with urllib.request.urlopen(base_url, timeout=5) as response:
        html = response.read().decode("utf-8")
        assert response.status == 200
        assert "/__tech/overlay.js" in html, "review panel was not injected"
    for name in ("overlay.js", "overlay.css", "anchor-core.js", "finder.js"):
        with urllib.request.urlopen(base_url + "__tech/" + name, timeout=5) as response:
            assert response.status == 200 and response.read(), f"{name} is unavailable"


def check_conversation_handoff(skill, demo):
    process, base = start_server(skill / "scripts/server.mjs", demo, "--conversation-model")
    task_script = skill / "scripts/conversation-task.mjs"
    port = base.split(":")[2].rstrip("/")
    try:
        task = json.loads(run_command(NODE, task_script, "next", "--source", demo, "--port", port))
        assert task["type"] == "page_batch" and "index.html" in task["prompt"]
        page = {"path": "/index.html", "title": "保存名称", "purpose": "输入并保存名称。",
                "layout": [{"text": "页面显示名称输入框和保存按钮。", "origin": "source_observed", "evidence": ["index.html:1"]}],
                "functions": [], "states": [], "data": [], "open_questions": [], "evidence": ["index.html:1"]}
        submit = {"job_id": task["job_id"], "source_snapshot_id": task["source_snapshot_id"],
                  "evidence_hash": task["evidence_hash"], "result": {"pages": [page]}}
        result_file = demo.parent / "conversation-page-result.json"
        result_file.write_text(json.dumps(submit, ensure_ascii=False), encoding="utf-8")
        reply = json.loads(run_command(NODE, task_script, "submit", "--source", demo, "--port", port, "--file", result_file))
        assert reply["status"] == "returned"
        state = json.loads((demo / "docs/prototype-talk/review-state.json").read_text(encoding="utf-8"))
        assert state["page_specs"][-1]["generator"] == "conversation"
        operation_id = state["operations"][0]["operation_id"]
        request = urllib.request.Request(base + "__tech/jobs", data=json.dumps({"operation_id": operation_id}).encode(),
                                         headers={"Content-Type": "application/json"}, method="POST")
        with urllib.request.urlopen(request, timeout=5) as response:
            assert response.status == 202
        operation = json.loads(run_command(NODE, task_script, "next", "--source", demo, "--port", port))
        assert operation["type"] == "operation" and operation["job_id"]
        card = {"title": "保存名称", "summary": "点击保存后更新当前页面标题。",
                "page_context": {"purpose": "输入名称", "layout": "输入框和保存按钮", "evidence": ["index.html:1"]},
                "claims": [{"section": "behavior", "text": "保存后更新页面标题。", "detail": "按钮调用保存函数。",
                            "origin": "source_observed", "evidence": ["index.html:1", "app.js:1"]}],
                "issues": [], "expected_effects": [], "expected_after": {"route_contains": "", "visible_text": ""}}
        submit = {"job_id": operation["job_id"], "source_snapshot_id": operation["source_snapshot_id"],
                  "evidence_hash": operation["evidence_hash"], "result": card}
        result_file.write_text(json.dumps(submit, ensure_ascii=False), encoding="utf-8")
        reply = json.loads(run_command(NODE, task_script, "submit", "--source", demo, "--port", port, "--file", result_file))
        assert reply["status"] == "returned"
        state = json.loads((demo / "docs/prototype-talk/review-state.json").read_text(encoding="utf-8"))
        assert state["cards"][-1]["generator"] == "conversation"
    finally:
        stop(process)


def verify_archive(archive_path):
    with tempfile.TemporaryDirectory(prefix="prototype-talk-release-check-") as temporary:
        temporary = Path(temporary)
        with ZipFile(archive_path) as archive:
            archive.extractall(temporary)
        extracted = temporary / PACKAGE
        skill = extracted / "skills/prototype-talk"
        required = [extracted / "LICENSE", skill / "SKILL.md", skill / "scripts/server.mjs", skill / "scripts/source-regions.mjs", skill / "assets/overlay.js"]
        for path in required:
            assert path.is_file(), f"package is missing {path.relative_to(extracted)}"

        demo = temporary / "demo"
        demo.mkdir()
        (demo / "index.html").write_text('<!doctype html><title>Release check</title><label>名称<input id="name"></label><button id="save" onclick="save()">保存</button><script src="app.js"></script>', encoding="utf-8")
        (demo / "app.js").write_text('function save() { document.title = document.getElementById("name").value || "Saved"; }', encoding="utf-8")
        (demo / "PRD.md").write_text('# 保存名称\n点击保存后更新页面标题。\n', encoding="utf-8")

        run_command(NODE, skill / "scripts/doctor.mjs", "--source", demo)
        first, first_url = start_server(skill / "scripts/server.mjs", demo)
        try:
            check_http(first_url)
        finally:
            stop(first)
        check_conversation_handoff(skill, demo)

        viewer = demo / "docs/prototype-talk/viewer"
        assert (viewer / "scripts/source-regions.mjs").is_file()
        assert (viewer / "assets/blind-review-template.html").is_file()
        state = json.loads((demo / "docs/prototype-talk/review-state.json").read_text(encoding="utf-8"))
        assert state["scan_summary"]["operation_count"] > 0, "source controls were not indexed"

        react_demo = temporary / "react-demo"
        (react_demo / "src").mkdir(parents=True)
        (react_demo / "src/App.jsx").write_text('export default function App() { return <button onClick={() => save()}>保存草稿</button>; }\nfunction save() { return true; }', encoding="utf-8")
        (react_demo / "index.html").write_text('<!doctype html><div id="root"></div><script type="module" src="/src/App.jsx"></script>', encoding="utf-8")
        (react_demo / "PRD.md").write_text('# 保存草稿\n点击按钮保存当前内容。\n', encoding="utf-8")
        (react_demo / "dist").mkdir()
        (react_demo / "dist/index.html").write_text('<!doctype html><title>Built React preview</title><button>保存草稿</button>', encoding="utf-8")
        run_command(NODE, skill / "scripts/doctor.mjs", "--source", react_demo)
        react_first, react_url = start_server(skill / "scripts/server.mjs", react_demo)
        try:
            check_http(react_url)
        finally:
            stop(react_first)
        react_state = json.loads((react_demo / "docs/prototype-talk/review-state.json").read_text(encoding="utf-8"))
        assert react_state["scan_summary"]["operation_count"] > 0, "JSX controls were not indexed"

        shutil.rmtree(extracted)  # Prove the exported viewer has no dependency on the installed Skill.
        second, second_url = start_server(viewer / "scripts/server.mjs", demo)
        try:
            check_http(second_url)
        finally:
            stop(second)
        react_viewer = react_demo / "docs/prototype-talk/viewer/scripts/server.mjs"
        react_second, react_second_url = start_server(react_viewer, react_demo)
        try:
            check_http(react_second_url)
        finally:
            stop(react_second)
    print(f"PASS: unpacked Skill, HTML/JS and built JSX scans, original and standalone exported viewers ({archive_path})")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "dist/prototype-talk.zip")
    args = parser.parse_args()
    count = build_archive(args.output)
    verify_archive(args.output)
    print(f"Archive ready: {args.output} ({count} files)")
