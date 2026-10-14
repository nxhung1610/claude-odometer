"""Counts the tokens each model used per local day, from the session transcripts.

Prints one JSON object:
  {"sessions": n, "days": {"YYYY-MM-DD": {model: {input, output, cacheRead, cacheWrite}}}}

Here n counts the session transcripts that had usage. A sub-agent transcript adds
its tokens, but it is not a session of its own.

A response is written to a transcript once per content block, with the same
message id and the same usage each time, so each message id is counted once.
Each line is parsed, but only the usage counts, the model, the timestamp and the
file's place in the folders are used; no message text is kept.
"""

import datetime
import glob
import json
import math
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


def is_session_transcript(path, root=ROOT):
    """True for <project>/<session>.jsonl, a session's own transcript, not a sub-agent's."""
    return len(os.path.relpath(path, root).split(os.sep)) == 2


def count(value):
    """A token count, or 0 for anything that is not a finite number, so one odd field cannot stop the scan."""
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        return 0
    return int(value)


def summarize(paths, root=ROOT):
    """The sessions and per-day tokens of the given transcripts, read in the order given."""
    seen = set()
    sessions = set()
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
                # A session counts once, by its own transcript, whether or not its responses were
                # counted from another file first, so the count does not depend on the file order.
                if is_session_transcript(path, root):
                    sessions.add(path)
                if message_id in seen:
                    continue
                seen.add(message_id)
                model = message.get("model")
                if not isinstance(model, str) or not model:
                    model = "unknown"
                tally = days.setdefault(day, {}).setdefault(model, dict.fromkeys(FIELDS, 0))
                for key, field in FIELDS.items():
                    tally[key] += count(usage.get(field))
    return {"sessions": len(sessions), "days": days}


def main():
    paths = glob.glob(os.path.join(ROOT, "**", "*.jsonl"), recursive=True)
    json.dump(summarize(paths), sys.stdout)


if __name__ == "__main__":
    main()
