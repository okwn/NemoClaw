#!/usr/bin/env python3
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

"""Drive the real #3145 user path: nemoclaw connect -> openclaw tui."""

from __future__ import annotations

import argparse
import fcntl
import json
import os
import pty
import re
import select
import signal
import struct
import subprocess
import sys
import termios
import time
from dataclasses import dataclass
from typing import Callable


ROWS = 80
COLS = 180
RAW_LOG = "/tmp/nemoclaw-issue3145-tui-raw.log"
SCREEN_LOG = "/tmp/nemoclaw-issue3145-tui-screen.log"
ANALYSIS_LOG = "/tmp/nemoclaw-issue3145-tui-analysis.json"
INTERESTING_LOG = "/tmp/nemoclaw-issue3145-tui-interesting.log"


@dataclass(frozen=True)
class MessageSpec:
    prompt_token: str
    reply_token: str
    message: str


MESSAGES = [
    MessageSpec("P3145A", "R3145A", "P3145A reply exactly R3145A"),
    MessageSpec("P3145B", "R3145B", "P3145B reply exactly R3145B"),
    MessageSpec("P3145C", "R3145C", "P3145C reply exactly R3145C"),
    MessageSpec("P3145D", "R3145D", "P3145D reply exactly R3145D"),
    MessageSpec("P3145E", "R3145E", "P3145E reply exactly R3145E"),
]


class TerminalScreen:
    def __init__(self, rows: int = ROWS, cols: int = COLS) -> None:
        self.rows = rows
        self.cols = cols
        self.grid = [[" "] * cols for _ in range(rows)]
        self.row = 0
        self.col = 0
        self._esc = ""

    def text(self) -> str:
        return "\n".join("".join(row).rstrip() for row in self.grid).rstrip()

    def feed(self, data: bytes) -> None:
        for char in data.decode("utf-8", "ignore"):
            self._feed_char(char)

    def _feed_char(self, char: str) -> None:
        if self._esc:
            self._esc += char
            if self._escape_complete(self._esc):
                self._handle_escape(self._esc)
                self._esc = ""
            return

        if char == "\x1b":
            self._esc = char
            return
        if char == "\r":
            self.col = 0
            return
        if char == "\n":
            self._newline()
            return
        if char == "\b":
            self.col = max(0, self.col - 1)
            return
        if char in ("\x00", "\x07") or ord(char) < 32:
            return

        self.grid[self.row][self.col] = char
        self.col += 1
        if self.col >= self.cols:
            self.col = 0
            self._newline()

    def _newline(self) -> None:
        self.row += 1
        if self.row >= self.rows:
            self.grid.pop(0)
            self.grid.append([" "] * self.cols)
            self.row = self.rows - 1

    @staticmethod
    def _escape_complete(seq: str) -> bool:
        if len(seq) < 2:
            return False
        if seq.startswith("\x1b]"):
            return seq.endswith("\x07") or seq.endswith("\x1b\\")
        if seq.startswith("\x1b["):
            return bool(re.match(r"^\x1b\[[0-9;?]*[@-~]$", seq))
        return len(seq) >= 2

    def _handle_escape(self, seq: str) -> None:
        if seq.startswith("\x1b]"):
            return
        if not seq.startswith("\x1b["):
            return

        body = seq[2:-1]
        final = seq[-1]
        private = body.startswith("?")
        if private:
            body = body[1:]
        params = [self._parse_int(part, 0) for part in body.split(";") if part != ""]

        if final in ("h", "l"):
            if private and any(value in (47, 1047, 1049) for value in params):
                self._clear_screen()
            return
        if final == "m":
            return
        if final in ("H", "f"):
            row = (params[0] if len(params) >= 1 and params[0] > 0 else 1) - 1
            col = (params[1] if len(params) >= 2 and params[1] > 0 else 1) - 1
            self.row = min(max(row, 0), self.rows - 1)
            self.col = min(max(col, 0), self.cols - 1)
            return
        if final == "G":
            col = (params[0] if params and params[0] > 0 else 1) - 1
            self.col = min(max(col, 0), self.cols - 1)
            return
        if final == "A":
            self.row = max(0, self.row - (params[0] if params and params[0] > 0 else 1))
            return
        if final == "B":
            self.row = min(self.rows - 1, self.row + (params[0] if params and params[0] > 0 else 1))
            return
        if final == "C":
            self.col = min(self.cols - 1, self.col + (params[0] if params and params[0] > 0 else 1))
            return
        if final == "D":
            self.col = max(0, self.col - (params[0] if params and params[0] > 0 else 1))
            return
        if final == "J":
            mode = params[0] if params else 0
            if mode in (2, 3):
                self._clear_screen()
            elif mode == 0:
                self.grid[self.row][self.col :] = [" "] * (self.cols - self.col)
                for row in range(self.row + 1, self.rows):
                    self.grid[row] = [" "] * self.cols
            return
        if final == "K":
            mode = params[0] if params else 0
            if mode == 2:
                self.grid[self.row] = [" "] * self.cols
            elif mode == 1:
                self.grid[self.row][: self.col + 1] = [" "] * (self.col + 1)
            else:
                self.grid[self.row][self.col :] = [" "] * (self.cols - self.col)
            return
        if final == "S":
            count = params[0] if params and params[0] > 0 else 1
            for _ in range(count):
                self.grid.pop(0)
                self.grid.append([" "] * self.cols)
            return

    def _clear_screen(self) -> None:
        self.grid = [[" "] * self.cols for _ in range(self.rows)]
        self.row = 0
        self.col = 0

    @staticmethod
    def _parse_int(value: str, default: int) -> int:
        try:
            return int(value)
        except ValueError:
            return default


class PtySession:
    def __init__(self, argv: list[str], env: dict[str, str]) -> None:
        self.master, slave = pty.openpty()
        winsize = struct.pack("HHHH", ROWS, COLS, 0, 0)
        fcntl.ioctl(slave, termios.TIOCSWINSZ, winsize)
        self.proc = subprocess.Popen(
            argv,
            stdin=slave,
            stdout=slave,
            stderr=slave,
            env=env,
            preexec_fn=os.setsid,
            close_fds=True,
        )
        os.close(slave)
        os.set_blocking(self.master, False)
        self.raw = bytearray()
        self.screen = TerminalScreen()

    def write(self, text: str) -> None:
        os.write(self.master, text.encode("utf-8"))

    def pump(self, timeout: float = 0.1) -> None:
        ready, _, _ = select.select([self.master], [], [], timeout)
        if not ready:
            return
        try:
            data = os.read(self.master, 65536)
        except OSError:
            return
        if not data:
            return
        self.raw.extend(data)
        self.screen.feed(data)

    def wait_for(self, predicate: Callable[[str, str], bool], timeout: float, label: str) -> None:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            self.pump(0.2)
            raw_text = self.raw.decode("utf-8", "ignore")
            screen_text = self.screen.text()
            if predicate(raw_text, screen_text):
                return
            if self.proc.poll() is not None:
                raise RuntimeError(f"{label}: process exited early with code {self.proc.returncode}")
        raise TimeoutError(f"timed out waiting for {label}")

    def close(self) -> None:
        try:
            os.killpg(self.proc.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        try:
            self.proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            try:
                os.killpg(self.proc.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            self.proc.wait(timeout=5)
        os.close(self.master)


def token_positions(text: str, token: str) -> list[int]:
    return [match.start() for match in re.finditer(re.escape(token), text)]


def strip_terminal_control(text: str) -> str:
    text = re.sub(r"\x1b\][^\x07]*(?:\x07|\x1b\\)", "", text)
    text = re.sub(r"\x1b\[[0-9;?]*[@-~]", "", text)
    text = re.sub(r"\x1b.", "", text)
    return text.replace("\r", "\n")


def analyze_visible_screen(screen_text: str) -> dict[str, object]:
    failures: list[str] = []
    prompt_positions: list[int] = []
    reply_positions: list[int] = []

    for spec in MESSAGES:
        prompts = token_positions(screen_text, spec.prompt_token)
        replies = token_positions(screen_text, spec.reply_token)
        prompt_positions.append(prompts[0] if prompts else -1)
        reply_positions.append(replies[-1] if replies else -1)

        if len(prompts) != 1:
            failures.append(f"{spec.prompt_token}: expected 1 visible user turn, found {len(prompts)}")
        if len(replies) != 2:
            failures.append(
                f"{spec.reply_token}: expected 2 visible occurrences (prompt + reply), found {len(replies)}"
            )
        if prompts and replies and replies[-1] < prompts[0]:
            failures.append(f"{spec.reply_token}: assistant reply rendered before {spec.prompt_token}")

    if any(pos < 0 for pos in prompt_positions):
        failures.append(f"missing prompt token(s): {prompt_positions}")
    elif prompt_positions != sorted(prompt_positions):
        failures.append(f"prompt order is wrong: {prompt_positions}")

    if any(pos < 0 for pos in reply_positions):
        failures.append(f"missing reply token(s): {reply_positions}")
    elif reply_positions != sorted(reply_positions):
        failures.append(f"reply order is wrong: {reply_positions}")

    return {
        "failures": failures,
        "promptPositions": prompt_positions,
        "replyPositions": reply_positions,
        "messages": [spec.__dict__ for spec in MESSAGES],
    }


def extract_interesting_lines(raw_plain: str) -> list[str]:
    patterns = (
        "P3145",
        "R3145",
        "history failed",
        "gateway request timeout",
        "send failed",
        "gateway closed",
        "connected |",
        "sending",
        "streaming",
        "openclaw tui",
        "openclaw-tui",
        "inference/",
    )
    interesting: list[str] = []
    for line in raw_plain.splitlines():
        text = line.strip()
        if not text:
            continue
        lowered = text.lower()
        if any(pattern.lower() in lowered for pattern in patterns):
            interesting.append(text[:1200])
    return interesting[-700:]


def run(sandbox_name: str) -> int:
    env = os.environ.copy()
    env.update(
        {
            "TERM": "xterm-256color",
            "COLUMNS": str(COLS),
            "LINES": str(ROWS),
            "NEMOCLAW_CONNECT_TIMEOUT": env.get("NEMOCLAW_CONNECT_TIMEOUT", "240"),
        }
    )
    session = PtySession(["nemoclaw", sandbox_name, "connect"], env)
    try:
        session.wait_for(
            lambda raw, screen: "Inside the sandbox" in raw or "sandbox@" in screen,
            180,
            "nemoclaw connect shell",
        )
        session.write("openclaw tui\r")
        session.wait_for(
            lambda raw, screen: "openclaw tui" in screen and "OpenClaw" in screen and "session" in screen,
            120,
            "OpenClaw TUI",
        )
        session.wait_for(
            lambda raw, screen: (
                "connected | idle" in f"{screen}\n{strip_terminal_control(raw)}"
                and "openclaw-tui" in f"{screen}\n{strip_terminal_control(raw)}"
                and "inference/" in f"{screen}\n{strip_terminal_control(raw)}"
            ),
            180,
            "OpenClaw TUI routed-model readiness",
        )

        time.sleep(2)
        for spec in MESSAGES:
            session.write(spec.message + "\r")
            deadline = time.monotonic() + 0.5
            while time.monotonic() < deadline:
                session.pump(0.05)

        deadline = time.monotonic() + 180
        while time.monotonic() < deadline:
            session.pump(0.2)
            screen_text = session.screen.text()
            if all(len(token_positions(screen_text, spec.reply_token)) >= 2 for spec in MESSAGES):
                break

        raw_text = session.raw.decode("utf-8", "ignore")
        screen_text = session.screen.text()
        raw_plain = strip_terminal_control(raw_text)
        with open(RAW_LOG, "w", encoding="utf-8") as handle:
            handle.write(raw_text)
        with open(SCREEN_LOG, "w", encoding="utf-8") as handle:
            handle.write(screen_text)

        analysis_text = (
            screen_text
            if all(spec.prompt_token in screen_text for spec in MESSAGES)
            else raw_plain
        )
        analysis = analyze_visible_screen(analysis_text)
        analysis["analysisSource"] = "screen" if analysis_text == screen_text else "raw-terminal-stream"
        raw_token_positions: dict[str, list[int]] = {}
        for spec in MESSAGES:
            raw_token_positions[spec.prompt_token] = token_positions(raw_plain, spec.prompt_token)
            raw_token_positions[spec.reply_token] = token_positions(raw_plain, spec.reply_token)
        analysis["rawTokenPositions"] = raw_token_positions
        failures = analysis["failures"]
        if isinstance(failures, list):
            lowered = raw_plain.lower()
            for marker in (
                "send failed:",
                "history failed:",
                "gateway request timeout",
                "gateway closed",
            ):
                if marker in lowered:
                    failures.append(f"TUI reported {marker.rstrip(':')}")
        with open(ANALYSIS_LOG, "w", encoding="utf-8") as handle:
            json.dump(analysis, handle, indent=2, sort_keys=True)
            handle.write("\n")
        with open(INTERESTING_LOG, "w", encoding="utf-8") as handle:
            for line in extract_interesting_lines(raw_plain):
                handle.write(line + "\n")
        print("ISSUE3145_TUI_RESULT " + json.dumps(analysis, sort_keys=True))
        if analysis["failures"]:
            print(f"Captured TUI screen: {SCREEN_LOG}", file=sys.stderr)
            print(f"Captured raw PTY log: {RAW_LOG}", file=sys.stderr)
            print(f"Captured TUI analysis: {ANALYSIS_LOG}", file=sys.stderr)
            print(f"Captured TUI interesting lines: {INTERESTING_LOG}", file=sys.stderr)
            for failure in analysis["failures"]:
                print(f"FAIL: {failure}", file=sys.stderr)
            return 1
        return 0
    finally:
        session.close()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("sandbox_name")
    args = parser.parse_args()
    return run(args.sandbox_name)


if __name__ == "__main__":
    raise SystemExit(main())
