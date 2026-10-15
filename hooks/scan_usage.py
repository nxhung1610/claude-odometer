"""Counts the tokens each model used per local day, from the session transcripts.

Prints one JSON object:
  {"root": "<projects folder read>", "sessionsByDay": {"YYYY-MM-DD": [session id, ...]},
   "days": {"YYYY-MM-DD": {model: {input, output, cacheRead, cacheWrite}}}}

A session id is the name of a session transcript without its .jsonl. It is listed on each
day that session had usage, its own or its sub-agents'. A sub-agent transcript adds its
tokens to the session that spawned it, but it is not a session of its own.

A response is written to a transcript once per content block, with the same
message id and the same usage each time, so each message id is counted once.
Each line is parsed, but only the usage counts, the model, the timestamp, the file's
name and the file's place in the folders are used; no message text is kept.
"""

import datetime
import glob
import json
import math
import os
import sys


def projects_root():
    """Claude Code's projects folder: $CLAUDE_CONFIG_DIR/projects, or ~/.claude/projects when that is unset or empty."""
    config = os.environ.get("CLAUDE_CONFIG_DIR") or "~/.claude"
    return os.path.join(os.path.expanduser(config), "projects")


ROOT = projects_root()
FIELDS = {
    "input": "input_tokens",
    "output": "output_tokens",
    "cacheRead": "cache_read_input_tokens",
    "cacheWrite": "cache_creation_input_tokens",
}


def local_day(stamp):
    try:
        when = datetime.datetime.fromisoformat(stamp.replace("Z", "+00:00"))
    except ValueError:
        return None
    return when.astimezone().date().isoformat()


def count(value):
    """A token count, or 0 for anything that is not a finite number, so one odd field cannot stop the scan."""
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        return 0
    return int(value)


def session_id(path):
    """A session transcript's name without .jsonl, which is the session's id."""
    return os.path.basename(path)[: -len(".jsonl")]


def owning_session(path, root=ROOT):
    """The session whose usage a transcript holds: its own, or, for a sub-agent, the session that spawned it.
    None for a file in neither place."""
    parts = os.path.relpath(path, root).split(os.sep)
    if os.pardir in parts:
        return None
    if len(parts) == 2:
        return session_id(path)
    if len(parts) >= 4 and parts[2] == "subagents":
        return parts[1]
    return None


def summarize(paths, root=ROOT):
    """The sessions per day and the per-day tokens of the given transcripts, read in the order given."""
    seen = set()
    session_days = {}
    days = {}
    for path in paths:
        with open(path, encoding="utf-8", errors="replace") as handle:
            for line in handle:
                if '"usage"' not in line:
                    continue
                try:
                    record = json.loads(line)
                except ValueError:
                    continue
                message = record.get("message") if isinstance(record, dict) else None
                if not isinstance(message, dict):
                    continue
                usage = message.get("usage")
                message_id = message.get("id")
                stamp = record.get("timestamp")
                if not isinstance(usage, dict) or not isinstance(message_id, str) or not message_id:
                    continue
                if not isinstance(stamp, str):
                    continue
                day = local_day(stamp)
                if day is None:
                    continue
                # A session counts once a day, however many of its transcripts had usage that day, so the
                # count does not depend on the file order.
                owner = owning_session(path, root)
                if owner is not None:
                    session_days.setdefault(day, set()).add(owner)
                if message_id in seen:
                    continue
                seen.add(message_id)
                model = message.get("model")
                if not isinstance(model, str) or not model:
                    model = "unknown"
                tally = days.setdefault(day, {}).setdefault(model, dict.fromkeys(FIELDS, 0))
                for key, field in FIELDS.items():
                    tally[key] += count(usage.get(field))
    return {
        "root": root,
        "sessionsByDay": {day: sorted(ids) for day, ids in session_days.items()},
        "days": days,
    }


def main():
    paths = glob.glob(os.path.join(ROOT, "**", "*.jsonl"), recursive=True)
    json.dump(summarize(paths), sys.stdout)


if __name__ == "__main__":
    main()
