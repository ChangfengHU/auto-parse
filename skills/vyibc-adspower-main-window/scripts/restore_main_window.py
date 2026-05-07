#!/usr/bin/env python3
import ctypes
import os
import subprocess
import sys
from typing import Iterable


WINDOW_TITLE = "AdsPower Browser"
PROCESS_KEYWORD = "adspower_global"


def run(cmd: list[str]) -> str:
    result = subprocess.run(cmd, check=True, capture_output=True, text=True)
    return result.stdout.strip()


def list_candidate_pids() -> list[int]:
    output = run(["ps", "-eo", "pid=,args="])
    pids: list[int] = []
    for line in output.splitlines():
        line = line.strip()
        if not line:
            continue
        pid_text, _, args = line.partition(" ")
        if PROCESS_KEYWORD not in args:
            continue
        if "SunBrowser" in args:
            continue
        if not pid_text.isdigit():
            continue
        pids.append(int(pid_text))
    return pids


def read_proc_environ(pid: int) -> dict[str, str]:
    path = f"/proc/{pid}/environ"
    data = open(path, "rb").read().split(b"\0")
    env: dict[str, str] = {}
    for entry in data:
        if b"=" not in entry:
            continue
        key, value = entry.split(b"=", 1)
        env[key.decode(errors="ignore")] = value.decode(errors="ignore")
    return env


def detect_display() -> str:
    for pid in list_candidate_pids():
        try:
            env = read_proc_environ(pid)
        except OSError:
            continue
        display = env.get("DISPLAY")
        if display:
            return display
    display = os.environ.get("DISPLAY")
    if display:
        return display
    raise RuntimeError("Cannot detect AdsPower DISPLAY from running processes.")


def xprop(display: str, args: Iterable[str]) -> str:
    return run(["bash", "-lc", f"DISPLAY={display} xprop {' '.join(args)}"])


def xwininfo(display: str, window_id: str) -> str:
    return run(["bash", "-lc", f"DISPLAY={display} xwininfo -id {window_id}"])


def list_window_ids(display: str) -> list[str]:
    output = xprop(display, ["-root", "_NET_CLIENT_LIST"])
    if "#" not in output:
        raise RuntimeError("No X11 client list found.")
    return [part.strip() for part in output.split("#", 1)[1].split(",") if part.strip()]


def find_main_window(display: str) -> str:
    for window_id in list_window_ids(display):
        props = xprop(display, ["-id", window_id, "WM_CLASS", "_NET_WM_NAME", "WM_NAME"])
        if WINDOW_TITLE in props:
            return window_id
    raise RuntimeError(f'No window matching "{WINDOW_TITLE}" found.')


def focus_window(display: str, window_id: str) -> None:
    libx11 = ctypes.cdll.LoadLibrary("libX11.so.6")
    libx11.XOpenDisplay.restype = ctypes.c_void_p

    display_ptr = libx11.XOpenDisplay(display.encode())
    if not display_ptr:
        raise RuntimeError(f"Cannot open X display {display}")

    try:
        window = ctypes.c_ulong(int(window_id, 16))
        libx11.XMapRaised(ctypes.c_void_p(display_ptr), window)
        libx11.XFlush(ctypes.c_void_p(display_ptr))
    finally:
        libx11.XCloseDisplay(ctypes.c_void_p(display_ptr))


def main() -> int:
    try:
        display = detect_display()
        window_id = find_main_window(display)
        focus_window(display, window_id)
        state = xwininfo(display, window_id)
        active = xprop(display, ["-root", "_NET_ACTIVE_WINDOW"])
    except Exception as exc:
        print(f"restore failed: {exc}", file=sys.stderr)
        return 1

    print(f"display: {display}")
    print(f"restored window: {window_id}")
    if "Map State: IsViewable" in state:
        print("window is viewable")
    if window_id.lower() in active.lower():
        print("window is active")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
