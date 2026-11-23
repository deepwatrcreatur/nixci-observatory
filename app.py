#!/usr/bin/env python3

"""Read-only HTTP API and static server for NixCI worker observability."""

from __future__ import annotations

import json
import os
import re
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlparse
from urllib.request import Request, urlopen


WEB_DIR = Path(os.environ.get("NIXCI_OBSERVATORY_WEB", Path(__file__).parent / "web"))
HOST = os.environ.get("NIXCI_OBSERVATORY_HOST", "127.0.0.1")
PORT = int(os.environ.get("NIXCI_OBSERVATORY_PORT", "8092"))
WORKER_UNIT = os.environ.get(
    "NIXCI_OBSERVATORY_WORKER_UNIT",
    "nix-ci-production-worker-emerald-worker-1.service",
)
REPOSITORIES = [
    item.strip()
    for item in os.environ.get(
        "NIXCI_OBSERVATORY_REPOSITORIES",
        "deepwatrcreatur/nix-clan-homelab,deepwatrcreatur/unified-nix-configuration",
    ).split(",")
    if item.strip()
]
REFRESH_SECONDS = max(15, int(os.environ.get("NIXCI_OBSERVATORY_REFRESH_SECONDS", "45")))
GITHUB_TOKEN = os.environ.get("GH_TOKEN")
WORKER_UNIT_RE = re.compile(r"^[A-Za-z0-9_.@:-]+\.service$")


class ResourceSampler:
    def __init__(self) -> None:
        self.previous_cpu: tuple[int, int, list[tuple[int, int]]] | None = None
        self.previous_processes: dict[int, int] = {}
        self.previous_worker_cpu: tuple[int, float] | None = None
        self.last_sample = 0.0

    @staticmethod
    def _cpu_ticks() -> tuple[int, int, list[tuple[int, int]]]:
        rows = Path("/proc/stat").read_text().splitlines()
        aggregate = rows[0].split()[1:]
        values = [int(value) for value in aggregate]
        idle = values[3] + (values[4] if len(values) > 4 else 0)
        total = sum(values)
        cores: list[tuple[int, int]] = []
        for row in rows[1:]:
            if not row.startswith("cpu") or not row[3:4].isdigit():
                continue
            fields = row.split()
            ticks = [int(value) for value in fields[1:]]
            core_idle = ticks[3] + (ticks[4] if len(ticks) > 4 else 0)
            cores.append((sum(ticks), core_idle))
        return total, idle, cores

    @staticmethod
    def _memory() -> dict[str, int]:
        values = {}
        for row in Path("/proc/meminfo").read_text().splitlines():
            key, _, raw = row.partition(":")
            fields = raw.split()
            if fields and fields[0].isdigit():
                values[key] = int(fields[0]) * 1024
        total = values.get("MemTotal", 0)
        available = values.get("MemAvailable", 0)
        return {"total": total, "used": max(0, total - available), "available": available}

    @staticmethod
    def _processes() -> tuple[list[dict], dict[int, int]]:
        clock_ticks = os.sysconf(os.sysconf_names["SC_CLK_TCK"])
        page_size = os.sysconf("SC_PAGE_SIZE")
        entries: list[dict] = []
        totals: dict[int, int] = {}
        for proc in Path("/proc").iterdir():
            if not proc.name.isdigit():
                continue
            try:
                stat = (proc / "stat").read_text()
                _, tail = stat.rsplit(")", 1)
                fields = tail.split()
                cpu_ticks = int(fields[11]) + int(fields[12])
                rss = max(0, int(fields[21])) * page_size
                comm = (proc / "comm").read_text().strip()[:48]
                cgroup = (proc / "cgroup").read_text()
                totals[int(proc.name)] = cpu_ticks
                entries.append({
                    "pid": int(proc.name),
                    "name": comm or "unknown",
                    "ticks": cpu_ticks,
                    "rss": rss,
                    "clockTicks": clock_ticks,
                    "worker": "nix-ci-production-worker" in cgroup,
                })
            except (OSError, ValueError, IndexError):
                continue
        return entries, totals

    @staticmethod
    def _worker() -> dict:
        if not WORKER_UNIT_RE.fullmatch(WORKER_UNIT):
            return {"state": "unknown", "error": "Invalid worker unit name"}
        try:
            result = subprocess.run(
                [
                    "systemctl", "show", WORKER_UNIT,
                    "--property=ActiveState,SubState,NRestarts,ExecMainStatus,ActiveEnterTimestamp,CPUUsageNSec,MemoryCurrent",
                ],
                capture_output=True,
                text=True,
                timeout=2,
                check=False,
            )
        except (OSError, subprocess.TimeoutExpired):
            return {"state": "unknown", "error": "systemd query unavailable"}
        if result.returncode != 0:
            return {"state": "unknown", "error": "Worker unit not found"}
        properties = dict(
            line.split("=", 1) for line in result.stdout.splitlines() if "=" in line
        )
        cpu_usec = None
        memory_bytes = None
        try:
            cpu_usec = int(properties.get("CPUUsageNSec", "")) // 1000
        except ValueError:
            pass
        try:
            memory_bytes = int(properties.get("MemoryCurrent", ""))
        except ValueError:
            pass
        return {
            "unit": WORKER_UNIT,
            "state": properties.get("ActiveState", "unknown"),
            "substate": properties.get("SubState", "unknown"),
            "restarts": int(properties.get("NRestarts", "0") or 0),
            "exitStatus": int(properties.get("ExecMainStatus", "0") or 0),
            "activeSince": properties.get("ActiveEnterTimestamp", "unknown"),
            "cpuUsec": cpu_usec,
            "memoryBytes": memory_bytes,
        }

    def snapshot(self) -> dict:
        now = time.monotonic()
        elapsed = max(0.001, now - self.last_sample) if self.last_sample else 0.0
        self.last_sample = now
        ncpu = os.cpu_count() or 1

        total, idle, core_ticks = self._cpu_ticks()
        cpu_pct = 0.0
        cores = []
        if self.previous_cpu:
            old_total, old_idle, old_cores = self.previous_cpu
            total_delta = max(1, total - old_total)
            cpu_pct = max(0.0, min(100.0, (1 - (idle - old_idle) / total_delta) * 100))
            for index, (core_total, core_idle) in enumerate(core_ticks):
                if index >= len(old_cores):
                    break
                old_core_total, old_core_idle = old_cores[index]
                core_delta = max(1, core_total - old_core_total)
                cores.append({
                    "index": index,
                    "usage": max(0.0, min(100.0, (1 - (core_idle - old_core_idle) / core_delta) * 100)),
                })
        self.previous_cpu = (total, idle, core_ticks)

        processes, process_ticks = self._processes()
        for process in processes:
            old_ticks = self.previous_processes.get(process["pid"])
            process["cpu"] = (
                max(0.0, (process["ticks"] - old_ticks) / process["clockTicks"] / elapsed / ncpu * 100)
                if old_ticks is not None and elapsed
                else 0.0
            )
            del process["ticks"]
            del process["clockTicks"]
        self.previous_processes = process_ticks
        processes.sort(key=lambda item: (item["worker"], item["cpu"], item["rss"]), reverse=True)

        worker = self._worker()
        worker_cpu = 0.0
        if worker.get("cpuUsec") is not None and self.previous_worker_cpu and elapsed:
            old_usec, old_time = self.previous_worker_cpu
            worker_cpu = max(0.0, (worker["cpuUsec"] - old_usec) / ((now - old_time) * 1_000_000) / ncpu * 100)
        if worker.get("cpuUsec") is not None:
            self.previous_worker_cpu = (worker["cpuUsec"], now)
        worker["cpuPercentHost"] = min(100.0, worker_cpu)
        del worker["cpuUsec"]

        memory = self._memory()
        statvfs = os.statvfs("/")
        disk_total = statvfs.f_blocks * statvfs.f_frsize
        disk_free = statvfs.f_bavail * statvfs.f_frsize
        load = os.getloadavg()
        return {
            "timestamp": time.time(),
            "host": {
                "hostname": os.uname().nodename,
                "uptimeSeconds": int(float(Path("/proc/uptime").read_text().split()[0])),
                "cpuPercent": cpu_pct,
                "cores": cores,
                "logicalCores": ncpu,
                "load": list(load),
                "memory": memory,
                "disk": {"total": disk_total, "used": max(0, disk_total - disk_free)},
            },
            "worker": worker,
            "processes": processes[:12],
        }


class SuiteFeed:
    def __init__(self) -> None:
        self.cached_at = 0.0
        self.cached_suites: list[dict] = []
        self.error: str | None = None
        self.refreshing = False
        self.lock = threading.Lock()

    def _get_json(self, url: str, *, github: bool = False):
        headers = {"Accept": "application/vnd.github+json" if github else "application/json"}
        if github and GITHUB_TOKEN:
            headers["Authorization"] = f"Bearer {GITHUB_TOKEN}"
        request = Request(url, headers=headers)
        with urlopen(request, timeout=5) as response:
            return json.load(response)

    def _suite_from_status(self, repo: str, pull: dict, status: dict) -> list[dict]:
        contexts = status.get("statuses", [])
        context = next((item for item in contexts if item.get("context") == "NixCI"), None)
        if not context or not context.get("target_url"):
            return []
        target_url = context["target_url"]
        target = urlparse(target_url)
        if target.scheme != "https" or target.hostname != "nix-ci.com":
            return []
        try:
            suite = self._get_json(target_url)
        except (HTTPError, URLError, TimeoutError, ValueError, OSError):
            suite = {"status": context.get("state", "unknown"), "runs": []}
        return [{
            "repository": repo,
            "pullRequest": pull.get("number"),
            "title": pull.get("title", "Commit suite"),
            "branch": pull.get("head", {}).get("ref", ""),
            "sha": pull.get("head", {}).get("sha", status.get("sha", "")),
            "url": target_url,
            "status": suite.get("status", context.get("state", "unknown")),
            "started": suite.get("started") or context.get("created_at"),
            "finished": suite.get("finished"),
            "runs": suite.get("runs", []),
        }]

    def _refresh(self) -> None:
        now = time.monotonic()
        suites: list[dict] = []
        errors = []
        try:
            for repo in REPOSITORIES:
                if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repo):
                    errors.append(f"Invalid repository name: {repo}")
                    continue
                try:
                    pulls = self._get_json(
                        f"https://api.github.com/repos/{repo}/pulls?state=open&sort=updated&direction=desc&per_page=8",
                        github=True,
                    )
                    for pull in pulls:
                        sha = pull.get("head", {}).get("sha")
                        if not sha:
                            continue
                        status = self._get_json(
                            f"https://api.github.com/repos/{repo}/commits/{quote(sha, safe='')}/status",
                            github=True,
                        )
                        suites.extend(self._suite_from_status(repo, pull, status))
                except (HTTPError, URLError, TimeoutError, ValueError, OSError) as exc:
                    errors.append(f"{repo}: {exc.__class__.__name__}")
            suites.sort(key=lambda item: item.get("started") or "", reverse=True)
            with self.lock:
                self.cached_at = now
                self.cached_suites = suites[:24]
                self.error = "; ".join(errors) if errors else None
        finally:
            with self.lock:
                self.refreshing = False

    def get(self) -> dict:
        now = time.monotonic()
        with self.lock:
            if now - self.cached_at >= REFRESH_SECONDS and not self.refreshing:
                self.refreshing = True
                threading.Thread(target=self._refresh, daemon=True).start()
            return {"updated": self.cached_at, "suites": self.cached_suites, "error": self.error}


sampler = ResourceSampler()
suite_feed = SuiteFeed()


class Handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        if self.path == "/api/snapshot":
            body = json.dumps({"resources": sampler.snapshot(), "ci": suite_feed.get()}).encode()
            self.respond(200, body, "application/json; charset=utf-8", cache="no-store")
            return
        route = self.path.split("?", 1)[0]
        if route == "/":
            route = "/index.html"
        relative = route.lstrip("/")
        path = (WEB_DIR / relative).resolve()
        if WEB_DIR.resolve() not in path.parents and path != WEB_DIR.resolve():
            self.respond(404, b"Not found", "text/plain; charset=utf-8")
            return
        try:
            body = path.read_bytes()
        except OSError:
            self.respond(404, b"Not found", "text/plain; charset=utf-8")
            return
        content_type = {
            ".css": "text/css; charset=utf-8",
            ".html": "text/html; charset=utf-8",
            ".js": "text/javascript; charset=utf-8",
            ".svg": "image/svg+xml",
        }.get(path.suffix, "application/octet-stream")
        self.respond(200, body, content_type)

    def respond(self, status: int, body: bytes, content_type: str, cache: str = "no-cache") -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", cache)
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt: str, *args) -> None:
        pass


def main() -> None:
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"NixCI Observatory listening on http://{HOST}:{PORT}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
