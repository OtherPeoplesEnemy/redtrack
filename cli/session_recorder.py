#!/usr/bin/env python3
"""
RedTrack CLI Session Recorder
Records shell commands and output to RedTrack.

Usage:
    python3 session_recorder.py start <jumpbox_id> [engagement_id]
    python3 session_recorder.py end
    python3 session_recorder.py list <jumpbox_id>
    python3 session_recorder.py view <session_id>
"""

import os
import pty
import sys
import select
import termios
import tty
import re
import json
import time
import requests
import configparser
from datetime import datetime
from pathlib import Path

CONFIG_DIR = Path.home() / ".redtrack"
SESSION_FILE = CONFIG_DIR / "current_session.json"

ANSI_RE = re.compile(r'\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])')

def clean_text(text):
    text = ANSI_RE.sub('', text)
    text = text.replace('\r\n', '\n').replace('\r', '\n')
    text = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]', '', text)
    return text.strip()


def load_config():
    ini_file = CONFIG_DIR / "config.ini"
    json_file = CONFIG_DIR / "config.json"
    if ini_file.exists():
        config = configparser.ConfigParser()
        config.read(ini_file)
        url = config.get("server", "url", fallback="")
        if not url.startswith("http"):
            url = "https://" + url
        return {"base_url": url.rstrip("/"), "api_key": config.get("server", "api_key", fallback="")}
    elif json_file.exists():
        with open(json_file) as f:
            return json.load(f)
    else:
        print("RedTrack not configured. Run: redtrack-cli config")
        sys.exit(1)


def get_headers(config):
    return {"X-API-Key": config["api_key"], "Content-Type": "application/json"}


def api_post(config, path, data=None):
    import urllib3
    urllib3.disable_warnings()
    return requests.post(
        f"{config['base_url']}/api{path}",
        json=data or {},
        headers=get_headers(config),
        verify=False,
        timeout=10
    )


def api_get(config, path):
    import urllib3
    urllib3.disable_warnings()
    return requests.get(
        f"{config['base_url']}/api{path}",
        headers=get_headers(config),
        verify=False,
        timeout=10
    )


def log_command(config, session_id, command, output, cwd="", exit_code=0):
    """Send a command log to RedTrack — non-blocking."""
    try:
        api_post(config, f"/jumpboxes/sessions/{session_id}/command", {
            "command": command,
            "output": output[:5000],  # Cap output at 5KB
            "exit_code": exit_code,
            "cwd": cwd,
        })
    except Exception:
        pass  # Never interrupt the session


def start_session(jumpbox_id, engagement_id=None):
    config = load_config()

    print(f"\033[0;31m[RedTrack]\033[0m Connecting to {config['base_url']}...")

    resp = api_post(config, f"/jumpboxes/{jumpbox_id}/sessions",
                    {"engagement_id": engagement_id})

    if resp.status_code != 201:
        print(f"\033[0;31m[RedTrack]\033[0m Failed: {resp.text}")
        sys.exit(1)

    data = resp.json()
    session_id = data["session_id"]

    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    with open(SESSION_FILE, "w") as f:
        json.dump({
            "session_id": session_id,
            "jumpbox_id": jumpbox_id,
            "base_url": config["base_url"],
            "api_key": config["api_key"],
        }, f)

    print(f"\033[0;31m[RedTrack]\033[0m \033[0;32mSession started!\033[0m ID: {session_id[:8]}...")
    print(f"\033[0;31m[RedTrack]\033[0m Recording all commands. Type \033[0;33mexit\033[0m to end session.\033[0m\n")

    _record_shell(session_id, config)


def _record_shell(session_id, config):
    """Record shell using PTY with clean ANSI stripping."""

    pid, master_fd = pty.fork()

    if pid == 0:
        shell = os.environ.get("SHELL", "/bin/bash")
        os.execv(shell, [shell])
        sys.exit(0)

    old_tty = termios.tcgetattr(sys.stdin)
    try:
        tty.setraw(sys.stdin.fileno())

        input_lines = []
        current_input = b""
        current_output = b""
        collecting_output = False

        while True:
            try:
                rfds, _, _ = select.select([sys.stdin, master_fd], [], [], 0.05)
            except (KeyboardInterrupt, OSError):
                break

            # User typed something
            if sys.stdin in rfds:
                try:
                    data = os.read(sys.stdin.fileno(), 256)
                except OSError:
                    break
                if not data:
                    break
                try:
                    os.write(master_fd, data)
                except OSError:
                    break

                # Track input — newline means command submitted
                if b'\n' in data or b'\r' in data:
                    cmd = clean_text(current_input.decode('utf-8', errors='replace'))
                    if cmd:
                        input_lines.append(cmd)
                        collecting_output = True
                        current_output = b""
                    current_input = b""
                else:
                    # Handle backspace
                    if data in (b'\x7f', b'\x08'):
                        current_input = current_input[:-1]
                    else:
                        current_input += data

            # Shell produced output
            if master_fd in rfds:
                try:
                    data = os.read(master_fd, 4096)
                except OSError:
                    break
                if not data:
                    break
                try:
                    os.write(sys.stdout.fileno(), data)
                except OSError:
                    break

                if collecting_output:
                    current_output += data

                    # Detect prompt (end of command output)
                    decoded = clean_text(data.decode('utf-8', errors='replace'))
                    if decoded.endswith('$') or decoded.endswith('#') or decoded.endswith('>'):
                        if input_lines:
                            cmd = input_lines.pop(0)
                            output = clean_text(current_output.decode('utf-8', errors='replace'))
                            # Remove the command echo from output
                            if output.startswith(cmd):
                                output = output[len(cmd):].strip()
                            cwd = os.getcwd()
                            log_command(config, session_id, cmd, output, cwd)
                        collecting_output = False
                        current_output = b""

    finally:
        termios.tcsetattr(sys.stdin, termios.TCSADRAIN, old_tty)
        try:
            os.waitpid(pid, 0)
        except Exception:
            pass

    print(f"\n\033[0;31m[RedTrack]\033[0m Session ended.")
    end_session_local()


def end_session_local():
    if not SESSION_FILE.exists():
        print("No active session.")
        return
    with open(SESSION_FILE) as f:
        session = json.load(f)
    config = {"base_url": session["base_url"], "api_key": session["api_key"]}
    resp = api_post(config, f"/jumpboxes/sessions/{session['session_id']}/end")
    if resp.status_code == 200:
        data = resp.json()
        dur = data.get("duration_seconds", 0)
        cmds = data.get("commands", 0)
        print(f"\033[0;31m[RedTrack]\033[0m Done — {cmds} commands, {dur // 60}m {dur % 60}s")
    SESSION_FILE.unlink(missing_ok=True)


def list_sessions(jumpbox_id):
    config = load_config()
    resp = api_get(config, f"/jumpboxes/{jumpbox_id}/sessions")
    if resp.status_code != 200:
        print(f"Failed: {resp.text}")
        return
    sessions = resp.json()
    if not sessions:
        print("No sessions recorded yet.")
        return
    print(f"\n{'ID':<12} {'User':<12} {'Started':<18} {'Duration':<10} {'Cmds':<6} Status")
    print("─" * 70)
    for s in sessions:
        dur = f"{s['duration_seconds']//60}m{s['duration_seconds']%60}s" if s.get('duration_seconds') else "Active"
        started = s['started_at'][:16].replace('T', ' ')
        sid = s['id'][:8] + "..."
        print(f"{sid:<12} {s['username']:<12} {started:<18} {dur:<10} {s['command_count']:<6} {s['status']}")


def view_session(session_id):
    config = load_config()
    resp = api_get(config, f"/jumpboxes/sessions/{session_id}")
    if resp.status_code != 200:
        print(f"Failed: {resp.text}")
        return
    s = resp.json()
    print(f"\n\033[0;31m[RedTrack]\033[0m Session: {s['id']}")
    print(f"User: @{s['username']} | Started: {s['started_at'][:16]} | Commands: {len(s['commands'])}\n")
    print("─" * 80)
    for cmd in s['commands']:
        ts = cmd['timestamp'][:19].replace('T', ' ')
        cwd = cmd.get('cwd', '')
        print(f"\033[0;34m[{ts}]\033[0m \033[0;32m{cwd}\033[0m")
        print(f"\033[0;31m$\033[0m \033[1m{cmd['command']}\033[0m")
        if cmd.get('output'):
            lines = cmd['output'].split('\n')[:15]
            for line in lines:
                print(f"  {line}")
            extra = len(cmd['output'].split('\n')) - 15
            if extra > 0:
                print(f"  \033[0;33m... {extra} more lines\033[0m")
        print()


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("RedTrack Session Recorder")
        print("Usage:")
        print("  python3 session_recorder.py start <jumpbox_id> [engagement_id]")
        print("  python3 session_recorder.py end")
        print("  python3 session_recorder.py list <jumpbox_id>")
        print("  python3 session_recorder.py view <session_id>")
        sys.exit(0)

    cmd = sys.argv[1]

    if cmd == "start":
        if len(sys.argv) < 3:
            print("Usage: python3 session_recorder.py start <jumpbox_id>")
            sys.exit(1)
        start_session(sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else None)

    elif cmd == "end":
        end_session_local()

    elif cmd == "list":
        if len(sys.argv) < 3:
            print("Usage: python3 session_recorder.py list <jumpbox_id>")
            sys.exit(1)
        list_sessions(sys.argv[2])

    elif cmd == "view":
        if len(sys.argv) < 3:
            print("Usage: python3 session_recorder.py view <session_id>")
            sys.exit(1)
        view_session(sys.argv[2])

    else:
        print(f"Unknown command: {cmd}")
        sys.exit(1)
