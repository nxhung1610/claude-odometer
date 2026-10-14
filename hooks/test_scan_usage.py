"""Tests for scan_usage.py. Run them with: python3 -m unittest discover -s hooks -p 'test_*.py'"""

import datetime
import json
import os
import subprocess
import sys
import tempfile
import unittest

SCRIPT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "scan_usage.py")
DAY = datetime.datetime.fromisoformat("2026-10-13T12:00:00+00:00").astimezone().date().isoformat()
USAGE = {"input_tokens": 10, "output_tokens": 5, "cache_read_input_tokens": 100, "cache_creation_input_tokens": 20}


def reply(message_id, model, usage, session="session-1", timestamp="2026-10-13T12:00:00Z"):
    """One assistant record as a transcript line."""
    return json.dumps(
        {"sessionId": session, "timestamp": timestamp, "message": {"id": message_id, "model": model, "usage": usage}}
    )


class ScanUsageTest(unittest.TestCase):
    def setUp(self):
        self.home = tempfile.TemporaryDirectory()
        self.addCleanup(self.home.cleanup)

    def write(self, path, *lines):
        """Writes a transcript under the fake home's .claude/projects."""
        file = os.path.join(self.home.name, ".claude", "projects", path)
        os.makedirs(os.path.dirname(file), exist_ok=True)
        with open(file, "w", encoding="utf-8") as handle:
            handle.write("\n".join(lines))

    def scan(self):
        """Runs the scanner with the fake home and reads what it prints."""
        env = dict(os.environ, HOME=self.home.name, USERPROFILE=self.home.name)
        ran = subprocess.run(
            [sys.executable, "-I", SCRIPT], env=env, capture_output=True, text=True, check=True
        )
        return json.loads(ran.stdout)

    def test_a_response_written_once_per_content_block_counts_once_across_files(self):
        self.write(
            "project/session-1.jsonl",
            reply("msg_1", "claude-opus-5-5", USAGE),
            reply("msg_1", "claude-opus-5-5", USAGE),
            reply("msg_2", "claude-sonnet-4-5-20250929", {"input_tokens": 7, "output_tokens": 3}),
        )
        # The same response again, in a sub-agent transcript.
        self.write("project/session-1/subagents/agent-x.jsonl", reply("msg_1", "claude-opus-5-5", USAGE))

        days = self.scan()["days"]
        self.assertEqual(days[DAY]["claude-opus-5-5"], {"input": 10, "output": 5, "cacheRead": 100, "cacheWrite": 20})
        self.assertEqual(
            days[DAY]["claude-sonnet-4-5-20250929"], {"input": 7, "output": 3, "cacheRead": 0, "cacheWrite": 0}
        )

    def test_lines_with_no_usage_no_id_no_readable_time_or_broken_json_are_skipped(self):
        user_line = {"type": "user", "sessionId": "session-1", "timestamp": "2026-10-13T12:00:00Z"}
        user_line["message"] = {"role": "user", "content": "hi"}
        no_id = {"sessionId": "session-1", "timestamp": "2026-10-13T12:00:00Z"}
        no_id["message"] = {"model": "claude-opus-5-5", "usage": {"input_tokens": 1}}
        self.write(
            "project/session-1.jsonl",
            json.dumps(user_line),
            reply("msg_3", "claude-opus-5-5", {"input_tokens": 1}, timestamp="not-a-date"),
            json.dumps(no_id),
            '{"message": {"usage": ',
            reply("msg_4", "claude-opus-5-5", {"input_tokens": 4}),
        )

        self.assertEqual(
            self.scan()["days"],
            {DAY: {"claude-opus-5-5": {"input": 4, "output": 0, "cacheRead": 0, "cacheWrite": 0}}},
        )

    def test_sessions_counts_each_session_with_usage_once_sub_agent_files_included(self):
        self.write("project/session-a.jsonl", reply("msg_1", "claude-opus-5-5", {"input_tokens": 1}, session="session-a"))
        self.write(
            "project/session-a/subagents/agent-x.jsonl",
            reply("msg_2", "claude-opus-5-5", {"input_tokens": 1}, session="session-a"),
        )
        self.write("project/session-b.jsonl", reply("msg_3", "claude-opus-5-5", {"input_tokens": 1}, session="session-b"))
        self.write(
            "project/session-c.jsonl",
            json.dumps({"type": "user", "sessionId": "session-c", "message": {"role": "user", "content": "hi"}}),
        )

        self.assertEqual(self.scan()["sessions"], 2)


if __name__ == "__main__":
    unittest.main()
