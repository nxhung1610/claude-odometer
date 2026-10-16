"""Tests for scan_usage.py. Run them with: python3 -m unittest discover -s hooks -p 'test_*.py'"""

import datetime
import json
import os
import subprocess
import sys
import tempfile
import unittest

import scan_usage

SCRIPT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "scan_usage.py")
DAY = datetime.datetime.fromisoformat("2026-10-13T12:00:00+00:00").astimezone().date().isoformat()
USAGE = {"input_tokens": 10, "output_tokens": 5, "cache_read_input_tokens": 100, "cache_creation_input_tokens": 20}
TODAY = datetime.date(2026, 10, 15)


def stamp_days_ago(days):
    """A timestamp at noon UTC, that many days before TODAY: the same local day in any zone from UTC-11 to UTC+11."""
    return f"{(TODAY - datetime.timedelta(days=days)).isoformat()}T12:00:00Z"


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

    def scan(self, args=(), **extra):
        """Runs the scanner with the fake home, with any arguments given, and reads what it prints. CLAUDE_CONFIG_DIR is
        left out of the environment, so a developer's own setting cannot move the folder the tests read."""
        env = {key: value for key, value in os.environ.items() if key != "CLAUDE_CONFIG_DIR"}
        env.update(HOME=self.home.name, USERPROFILE=self.home.name, **extra)
        ran = subprocess.run(
            [sys.executable, "-I", SCRIPT, *args], env=env, capture_output=True, text=True, check=True
        )
        return json.loads(ran.stdout)

    def test_claude_config_dir_moves_the_projects_folder(self):
        custom = os.path.join(self.home.name, "custom-config")
        file = os.path.join(custom, "projects", "project", "session-1.jsonl")
        os.makedirs(os.path.dirname(file), exist_ok=True)
        with open(file, "w", encoding="utf-8") as handle:
            handle.write(reply("msg_1", "claude-opus-5-5", {"input_tokens": 9}))
        # The default folder holds other usage, which the scan must not read once the variable points away.
        self.write("project/session-1.jsonl", reply("msg_2", "claude-opus-5-5", {"input_tokens": 1}))

        scan = self.scan(CLAUDE_CONFIG_DIR=custom)
        self.assertEqual(scan["root"], os.path.join(custom, "projects"))
        self.assertEqual(scan["days"][DAY]["claude-opus-5-5"]["input"], 9)

    def test_an_empty_claude_config_dir_falls_back_to_the_default_folder(self):
        self.write("project/session-1.jsonl", reply("msg_1", "claude-opus-5-5", {"input_tokens": 4}))

        scan = self.scan(CLAUDE_CONFIG_DIR="")
        self.assertEqual(scan["root"], os.path.join(self.home.name, ".claude", "projects"))
        self.assertEqual(scan["days"][DAY]["claude-opus-5-5"]["input"], 4)

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

    def test_sessions_count_the_session_transcripts_that_had_usage(self):
        self.write("project/session-a.jsonl", reply("msg_1", "claude-opus-5-5", {"input_tokens": 1}, session="session-a"))
        self.write(
            "project/session-a/subagents/agent-x.jsonl",
            reply("msg_2", "claude-opus-5-5", {"input_tokens": 1}, session="session-a"),
        )
        # A sub-agent transcript that names a session id of its own still belongs to its parent.
        self.write(
            "project/session-a/subagents/agent-y.jsonl",
            reply("msg_3", "claude-opus-5-5", {"input_tokens": 1}, session="agent-only"),
        )
        self.write("project/session-b.jsonl", reply("msg_4", "claude-opus-5-5", {"input_tokens": 1}, session="session-b"))
        self.write(
            "project/session-c.jsonl",
            json.dumps({"type": "user", "sessionId": "session-c", "message": {"role": "user", "content": "hi"}}),
        )

        scan = self.scan()
        self.assertEqual(scan["sessions"]["all"], 2)
        # Sub-agent tokens still count toward the days: four responses, one input token each.
        self.assertEqual(scan["days"][DAY]["claude-opus-5-5"]["input"], 4)

    def test_a_session_with_usage_on_two_days_counts_once(self):
        first = datetime.datetime.fromisoformat("2026-10-12T12:00:00+00:00").astimezone().date().isoformat()
        second = datetime.datetime.fromisoformat("2026-10-13T12:00:00+00:00").astimezone().date().isoformat()
        self.write(
            "project/session-1.jsonl",
            reply("msg_1", "claude-opus-5-5", {"input_tokens": 1}, timestamp="2026-10-12T12:00:00Z"),
            reply("msg_2", "claude-opus-5-5", {"input_tokens": 1}, timestamp="2026-10-13T12:00:00Z"),
        )

        self.assertEqual(self.scan()["sessions"]["all"], 1)

    def test_a_sub_agent_adds_its_session_on_the_day_of_its_usage(self):
        second =datetime.datetime.fromisoformat("2026-10-13T12:00:00+00:00").astimezone().date().isoformat()
        self.write(
            "project/session-1.jsonl",
            reply("msg_1", "claude-opus-5-5", {"input_tokens": 5}, timestamp="2026-10-12T12:00:00Z"),
        )
        self.write(
            "project/session-1/subagents/agent-x.jsonl",
            reply("msg_2", "claude-opus-5-5", {"input_tokens": 7}, session="agent-x", timestamp="2026-10-13T12:00:00Z"),
        )

        scan = self.scan()
        self.assertEqual(scan["sessions"]["all"], 1)
        self.assertEqual(scan["days"][second]["claude-opus-5-5"]["input"], 7)

    def test_a_sub_agent_counts_toward_its_session_when_the_session_file_is_missing(self):
        self.write(
            "project/session-9/subagents/agent-z.jsonl",
            reply("msg_3", "claude-opus-5-5", {"input_tokens": 3}, session="agent-z"),
        )

        self.assertEqual(self.scan()["sessions"]["all"], 1)

    def test_a_scan_with_a_cache_prints_what_a_scan_without_one_prints(self):
        self.write(
            "project/session-1.jsonl",
            reply("msg_1", "claude-opus-5-5", USAGE),
            reply("msg_2", "claude-sonnet-4-5-20250929", {"input_tokens": 7}),
        )
        self.write("project/session-1/subagents/agent-x.jsonl", reply("msg_1", "claude-opus-5-5", USAGE))
        cache = os.path.join(self.home.name, "cache", "usage.json")

        fresh = self.scan()
        self.assertEqual(self.scan(args=["--cache", cache]), fresh)
        self.assertEqual(self.scan(args=["--cache", cache]), fresh)

    def test_an_unchanged_transcript_is_read_from_the_cache(self):
        self.write("project/session-1.jsonl", reply("msg_1", "claude-opus-5-5", {"input_tokens": 4}))
        cache = os.path.join(self.home.name, "cache", "usage.json")
        self.scan(args=["--cache", cache])

        # Change the cached count and leave the transcript alone: a scan that trusts the cache shows the change.
        with open(cache, encoding="utf-8") as handle:
            data = json.load(handle)
        (entry,) = data["files"].values()
        entry["records"][0][4] = 999
        with open(cache, "w", encoding="utf-8") as handle:
            json.dump(data, handle)
        self.assertEqual(self.scan(args=["--cache", cache])["days"][DAY]["claude-opus-5-5"]["input"], 999)

    def test_a_transcript_that_changed_is_read_again(self):
        self.write("project/session-1.jsonl", reply("msg_1", "claude-opus-5-5", {"input_tokens": 4}))
        cache = os.path.join(self.home.name, "cache", "usage.json")
        self.scan(args=["--cache", cache])

        # A response appended to the file changes its size, so the cached read is not trusted.
        file = os.path.join(self.home.name, ".claude", "projects", "project", "session-1.jsonl")
        with open(file, "a", encoding="utf-8") as handle:
            handle.write("\n" + reply("msg_2", "claude-opus-5-5", {"input_tokens": 6}))
        self.assertEqual(self.scan(args=["--cache", cache])["days"][DAY]["claude-opus-5-5"]["input"], 10)

    def test_a_transcript_that_was_removed_leaves_the_cache(self):
        self.write("project/session-1.jsonl", reply("msg_1", "claude-opus-5-5", {"input_tokens": 4}))
        self.write("project/session-2.jsonl", reply("msg_2", "claude-opus-5-5", {"input_tokens": 6}, session="session-2"))
        cache = os.path.join(self.home.name, "cache", "usage.json")
        self.scan(args=["--cache", cache])

        os.remove(os.path.join(self.home.name, ".claude", "projects", "project", "session-2.jsonl"))
        self.assertEqual(self.scan(args=["--cache", cache])["days"][DAY]["claude-opus-5-5"]["input"], 4)
        with open(cache, encoding="utf-8") as handle:
            self.assertEqual(len(json.load(handle)["files"]), 1)

    def test_a_cache_that_is_not_valid_is_read_past_and_written_again(self):
        self.write("project/session-1.jsonl", reply("msg_1", "claude-opus-5-5", {"input_tokens": 4}))
        cache = os.path.join(self.home.name, "cache", "usage.json")
        os.makedirs(os.path.dirname(cache))
        with open(cache, "w", encoding="utf-8") as handle:
            handle.write('{"version": 1, "files": ')

        self.assertEqual(self.scan(args=["--cache", cache])["days"][DAY]["claude-opus-5-5"]["input"], 4)
        with open(cache, encoding="utf-8") as handle:
            self.assertEqual(json.load(handle)["version"], 1)

    def test_a_cache_that_cannot_be_written_does_not_stop_the_scan(self):
        self.write("project/session-1.jsonl", reply("msg_1", "claude-opus-5-5", {"input_tokens": 4}))
        blocked = os.path.join(self.home.name, "blocked")
        with open(blocked, "w", encoding="utf-8") as handle:
            handle.write("a file where a folder is needed")

        scan = self.scan(args=["--cache", os.path.join(blocked, "usage.json")])
        self.assertEqual(scan["days"][DAY]["claude-opus-5-5"]["input"], 4)


class SummarizeTest(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.TemporaryDirectory()
        self.addCleanup(self.root.cleanup)

    def write(self, path, *lines):
        """Writes a transcript under a fake projects folder and returns its path."""
        file = os.path.join(self.root.name, path)
        os.makedirs(os.path.dirname(file), exist_ok=True)
        with open(file, "w", encoding="utf-8") as handle:
            handle.write("\n".join(lines))
        return file

    def test_a_non_numeric_count_is_zero_and_the_rest_still_counts(self):
        path = self.write(
            "project/session-1.jsonl",
            reply("msg_1", "claude-opus-5-5", {"input_tokens": "lots", "output_tokens": 5}),
            reply("msg_2", "claude-opus-5-5", {"input_tokens": 7}),
        )

        opus = scan_usage.summarize([path], root=self.root.name)["days"][DAY]["claude-opus-5-5"]
        self.assertEqual(opus["input"], 7)
        self.assertEqual(opus["output"], 5)

    def test_lines_of_the_wrong_shape_are_skipped(self):
        path = self.write(
            "project/session-1.jsonl",
            '[1, 2, "usage"]',
            '{"message": "usage"}',
            json.dumps({"message": {"id": ["not", "text"], "usage": {"input_tokens": 1}}, "timestamp": "2026-10-13T12:00:00Z"}),
            json.dumps(
                {
                    "message": {"id": "msg_9", "model": {"name": "x"}, "usage": {"input_tokens": 3}},
                    "timestamp": "2026-10-13T12:00:00Z",
                }
            ),
        )

        days = scan_usage.summarize([path], root=self.root.name)["days"]
        self.assertEqual(days, {DAY: {"unknown": {"input": 3, "output": 0, "cacheRead": 0, "cacheWrite": 0}}})

    def test_a_session_counts_whichever_of_its_files_is_read_first(self):
        sub_agent = self.write(
            "project/session-1/subagents/agent-x.jsonl",
            reply("msg_1", "claude-opus-5-5", {"input_tokens": 1}, session="session-1"),
        )
        main = self.write("project/session-1.jsonl", reply("msg_1", "claude-opus-5-5", {"input_tokens": 1}, session="session-1"))

        for order in ([sub_agent, main], [main, sub_agent]):
            with self.subTest(order=order):
                summary = scan_usage.summarize(order, root=self.root.name)
                self.assertEqual(summary["sessions"]["all"], 1)
                self.assertEqual(summary["days"][DAY]["claude-opus-5-5"]["input"], 1)

    def test_each_range_counts_a_session_once_and_starts_at_its_first_day(self):
        # Ranges count today and the 6 or 29 days before it, so 7 and 30 days back start one day later.
        paths = [
            self.write(
                "project/session-now.jsonl",
                reply("msg_1", "claude-opus-5-5", {"input_tokens": 1}, session="session-now", timestamp=stamp_days_ago(0)),
                reply("msg_2", "claude-opus-5-5", {"input_tokens": 1}, session="session-now", timestamp=stamp_days_ago(10)),
            ),
            self.write("project/session-6.jsonl", reply("msg_3", "claude-opus-5-5", {"input_tokens": 1}, session="session-6", timestamp=stamp_days_ago(6))),
            self.write("project/session-7.jsonl", reply("msg_4", "claude-opus-5-5", {"input_tokens": 1}, session="session-7", timestamp=stamp_days_ago(7))),
            self.write("project/session-29.jsonl", reply("msg_5", "claude-opus-5-5", {"input_tokens": 1}, session="session-29", timestamp=stamp_days_ago(29))),
            self.write("project/session-30.jsonl", reply("msg_6", "claude-opus-5-5", {"input_tokens": 1}, session="session-30", timestamp=stamp_days_ago(30))),
        ]

        summary = scan_usage.summarize(paths, root=self.root.name, today=TODAY)
        self.assertEqual(summary["sessions"], {"week": 2, "month": 4, "all": 5})

    def test_hours_count_each_response_once_at_its_local_hour(self):
        stamp = "2026-10-13T12:00:00Z"
        hour = datetime.datetime.fromisoformat(stamp.replace("Z", "+00:00")).astimezone().hour
        path = self.write(
            "project/session-1.jsonl",
            reply("msg_1", "claude-opus-5-5", USAGE, timestamp=stamp),
            reply("msg_1", "claude-opus-5-5", USAGE, timestamp=stamp),
        )

        hours = scan_usage.summarize([path], root=self.root.name)["hours"]
        # USAGE adds up to 135 tokens: 10 input, 5 output, 100 cache read and 20 cache write.
        self.assertEqual(hours[DAY][hour], 135)
        self.assertEqual(sum(hours[DAY]), 135)



if __name__ == "__main__":
    unittest.main()
