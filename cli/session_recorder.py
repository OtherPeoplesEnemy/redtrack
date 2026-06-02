#!/usr/bin/env python3
"""
RedTrack CLI Session Recorder
Wraps the shell and captures all commands + output to RedTrack.

Usage:
    redtrack-cli session start <jumpbox_id>
    redtrack-cli session end
    redtrack-cli sessions list <jumpbox_id>
    redtrack-cli sessions view <session_id>
"""

import os
import pty
import sys
import select
import termios
import tty
import signal
import json
import time
import re
import requests
from datetime import datetime
from pathlib import Path

CONFIG_FILE = Path.home() / ".redtrack" / "config.json"
SESSION_FILE = Path.home() / ".redtrack" / "current_session.json"


def load_config():
    if not CONFIG_FILE.exists():
        print("RedTrack not configured. Run: redtrack-cli config")
        sys.exit(1)
    with open(CONFIG_FILE) as f:
        return json.load(f)


def get_headers(config):
    return {
        "Authorization": f"Bearer {config['api_key']}",
        "Content-Type": "application/json"
    }


def start_session(jumpbox_id, engagement_id=None):
    config = load_config()
    base_url = config["base_url"].rstrip("/")

    print(f"\033[0;31m[RedTrack]\033[0m Starting session for jump box {jumpbox_id}...")

    resp = requests.post(
        f"{base_url}/api/jumpboxes/{jumpbox_id}/sessions",
        json={"engagement_id": engagement_id},
        headers=get_headers(config),
        verify=False
    )

    if resp.status_code != 201:
        print(f"\033[0;31m[RedTrack]\033[0m Failed to start session: {resp.text}")
        sys.exit(1)

    data = resp.json()
    session_id = data["session_id"]

    # Save session info locally
    SESSION_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(SESSION_FILE, "w") as f:
        json.dump({
            "session_id": session_id,
            "jumpbox_id": jumpbox_id,
            "base_url": base_url,
            "api_key": config["api_key"],
            "started_at": data["started_at"]
        }, f)

    print(f"\033[0;31m[RedTrack]\033[0m Session started: {session_id}")
    print(f"\033[0;31m[RedTrack]\033[0m All commands will be recorded. Type 'exit' or run 'redtrack-cli session end' to stop.\033[0m\n")

    # Start the recording shell
    _record_shell(session_id, base_url, get_headers(config))


def _record_shell(session_id, base_url, headers):
    """Wrap the shell using PTY and capture all I/O."""
    command_buffer = ""
    output_buffer = ""
    pending_command = None
    last_flush = time.time()

    def send_command(cmd, output, exit_code=0):
        if not cmd.strip():
            return
        try:
            requests.post(
                f"{base_url}/api/jumpboxes/sessions/{session_id}/command",
                json={
                    "command": cmd.strip(),
                    "output": output.strip(),
                    "exit_code": exit_code,
                    "cwd": os.getcwd(),
                },
                headers=headers,
                verify=False,
                timeout=5
            )
        except Exception:
            pass  # Don't interrupt the session if logging fails

    # Fork a PTY
    pid, master_fd = pty.fork()

    if pid == 0:
        # Child process — exec the shell
        shell = os.environ.get("SHELL", "/bin/bash")
        os.execv(shell, [shell])
    else:
        # Parent process — intercept I/O
        old_settings = termios.tcgetattr(sys.stdin)
        try:
            tty.setraw(sys.stdin.fileno())

            input_buf = b""
            output_buf = b""

            while True:
                try:
                    r, _, _ = select.select([sys.stdin, master_fd], [], [], 0.1)
                except (KeyboardInterrupt, OSError):
                    break

                if sys.stdin in r:
                    data = os.read(sys.stdin.fileno(), 1024)
                    if not data:
                        break
                    # Track what user types
                    input_buf += data
                    # Send to PTY
                    try:
                        os.write(master_fd, data)
                    except OSError:
                        break

                if master_fd in r:
                    try:
                        data = os.read(master_fd, 10240)
                    except OSError:
                        break
                    if not data:
                        break
                    # Write to terminal
                    os.write(sys.stdout.fileno(), data)
                    output_buf += data

                    # Flush command every time we see a prompt ($ or #)
                    decoded = data.decode("utf-8", errors="replace")
                    if decoded.strip().endswith("$") or decoded.strip().endswith("#") or decoded.strip().endswith(">"):
                        # Extract last command from input buffer
                        inp = input_buf.decode("utf-8", errors="replace")
                        lines = [l for l in inp.split("\n") if l.strip()]
                        if lines:
                            cmd = lines[-1].strip()
                            out = output_buf.decode("utf-8", errors="replace")
                            # Remove ANSI escape codes
                            ansi_escape = re.compile(r'\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])')
                            clean_out = ansi_escape.sub('', out)
                            send_command(cmd, clean_out)
                            input_buf = b""
                            output_buf = b""

                # Periodic flush every 30 seconds
                if time.time() - last_flush > 30:
                    inp = input_buf.decode("utf-8", errors="replace")
                    out = output_buf.decode("utf-8", errors="replace")
                    if inp.strip():
                        ansi_escape = re.compile(r'\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])')
                        send_command(inp.strip(), ansi_escape.sub('', out))
                        input_buf = b""
                        output_buf = b""
                    last_flush = time.time()

        finally:
            termios.tcsetattr(sys.stdin, termios.TCSADRAIN, old_settings)
            try:
                os.waitpid(pid, 0)
            except ChildProcessError:
                pass

        print(f"\n\033[0;31m[RedTrack]\033[0m Shell exited. Ending session...")
        end_session_local()


def end_session_local():
    """End the current session."""
    if not SESSION_FILE.exists():
        print("No active session found.")
        return

    with open(SESSION_FILE) as f:
        session = json.load(f)

    config = {"api_key": session["api_key"]}
    base_url = session["base_url"]
    session_id = session["session_id"]

    try:
        resp = requests.post(
            f"{base_url}/api/jumpboxes/sessions/{session_id}/end",
            headers=get_headers(config),
            verify=False,
            timeout=10
        )
        data = resp.json()
        duration = data.get("duration_seconds", 0)
        commands = data.get("commands", 0)
        mins = duration // 60
        secs = duration % 60
        print(f"\033[0;31m[RedTrack]\033[0m Session ended — {commands} commands logged, duration {mins}m {secs}s")
    except Exception as e:
        print(f"\033[0;31m[RedTrack]\033[0m Failed to end session: {e}")

    SESSION_FILE.unlink(missing_ok=True)


def list_sessions(jumpbox_id):
    config = load_config()
    base_url = config["base_url"].rstrip("/")

    resp = requests.get(
        f"{base_url}/api/jumpboxes/{jumpbox_id}/sessions",
        headers=get_headers(config),
        verify=False
    )

    if resp.status_code != 200:
        print(f"Failed: {resp.text}")
        return

    sessions = resp.json()
    if not sessions:
        print("No sessions found for this jump box.")
        return

    print(f"\n{'ID':<38} {'User':<15} {'Started':<20} {'Duration':<12} {'Commands':<10} {'Status'}")
    print("-" * 105)
    for s in sessions:
        duration = f"{s['duration_seconds'] // 60}m {s['duration_seconds'] % 60}s" if s.get('duration_seconds') else "Active"
        started = s['started_at'][:16].replace('T', ' ')
        print(f"{s['id']:<38} {s['username']:<15} {started:<20} {duration:<12} {s['command_count']:<10} {s['status']}")


def view_session(session_id):
    config = load_config()
    base_url = config["base_url"].rstrip("/")

    resp = requests.get(
        f"{base_url}/api/jumpboxes/sessions/{session_id}",
        headers=get_headers(config),
        verify=False
    )

    if resp.status_code != 200:
        print(f"Failed: {resp.text}")
        return

    session = resp.json()
    print(f"\n\033[0;31m[RedTrack]\033[0m Session: {session['id']}")
    print(f"User: {session['full_name']} (@{session['username']})")
    print(f"Started: {session['started_at'][:16].replace('T', ' ')}")
    if session.get('ended_at'):
        duration = session.get('duration_seconds', 0)
        print(f"Duration: {duration // 60}m {duration % 60}s")
    print(f"Commands: {len(session['commands'])}\n")
    print("─" * 80)

    for cmd in session['commands']:
        ts = cmd['timestamp'][:19].replace('T', ' ')
        cwd = cmd.get('cwd', '')
        print(f"\033[0;34m[{ts}]\033[0m \033[0;32m{cwd}\033[0m")
        print(f"\033[0;31m$\033[0m {cmd['command']}")
        if cmd.get('output'):
            # Show first 20 lines of output
            lines = cmd['output'].split('\n')[:20]
            for line in lines:
                print(f"  {line}")
            if len(cmd['output'].split('\n')) > 20:
                print(f"  \033[0;33m... ({len(cmd['output'].split(chr(10))) - 20} more lines)\033[0m")
        print()
