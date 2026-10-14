"""Counts the tokens each model used per local day, from the session transcripts.

Prints one JSON object:
  {"sessions": n, "days": {"YYYY-MM-DD": {model: {input, output, cacheRead, cacheWrite}}}}

Here n counts the sessions that had usage; a sub-agent transcript belongs to its session.

A response is written to a transcript once per content block, with the same
message id and the same usage each time, so each message id is counted once.
Each line is parsed, but only the usage counts, the model, the timestamp and the
session id are used; no message text is kept.
"""

import datetime
import glob
import json
import os
import sys

ROOT = os.path.expanduser("~/.claude/projects")
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


def main():
    seen = set()
    sessions = set()
    days = {}
    paths = glob.glob(os.path.join(ROOT, "**", "*.jsonl"), recursive=True)
    for path in paths:
        with open(path, encoding="utf-8", errors="replace") as handle:
            for line in handle:
                if '"usage"' not in line:
                    continue
                try:
                    record = json.loads(line)
                except ValueError:
                    continue
                message = record.get("message") or {}
                usage = message.get("usage")
                message_id = message.get("id")
                stamp = record.get("timestamp")
                if not isinstance(usage, dict) or not message_id or not isinstance(stamp, str):
                    continue
                if message_id in seen:
                    continue
                day = local_day(stamp)
                if day is None:
                    continue
                seen.add(message_id)
                # Count sessions by id; a line without one counts as its own file.
                session = record.get("sessionId")
                sessions.add(session if isinstance(session, str) and session else path)
                model = message.get("model") or "unknown"
                tally = days.setdefault(day, {}).setdefault(model, dict.fromkeys(FIELDS, 0))
                for key, field in FIELDS.items():
                    tally[key] += int(usage.get(field) or 0)
    json.dump({"sessions": len(sessions), "days": days}, sys.stdout)


if __name__ == "__main__":
    main()
