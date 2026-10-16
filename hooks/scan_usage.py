"""Counts the tokens each model used per local day, from the session transcripts.

Prints one JSON object:
  {"root": "<projects folder read>", "sessions": {"week": n, "month": n, "all": n},
   "days": {"YYYY-MM-DD": {model: {input, output, cacheRead, cacheWrite}}},
   "hours": {"YYYY-MM-DD": [24 token totals, one per local hour]}}

A session counts in a range when it had usage, its own or its sub-agents', on a day in that
range: the last 7 days and the last 30 days, both counting today, and all days up to today.
A sub-agent transcript adds its tokens to the session that spawned it, but it is not a session
of its own. Session ids are read to count sessions and are never printed.

A response is written to a transcript once per content block, with the same
message id and the same usage each time, so each message id is counted once.
Each line is parsed, but only the usage counts, the model, the timestamp, the file's
name and the file's place in the folders are used; no message text is kept.

With --cache PATH the scan keeps what it read of each transcript in that file, and the next scan reads again only the
transcripts whose size or modification time has changed. The cache is optional: one that is missing, unreadable or
cannot be written only means every transcript is read.
"""

import datetime
import glob
import json
import math
import os
import sys

# Bump this when the records a transcript is read into change, so an older cache is read past.
CACHE_VERSION = 1


def projects_root():
    """Claude Code's projects folder: $CLAUDE_CONFIG_DIR/projects, or ~/.claude/projects when that is unset or empty."""
    config = os.environ.get("CLAUDE_CONFIG_DIR") or os.path.join(os.path.expanduser("~"), ".claude")
    return os.path.join(os.path.expanduser(config), "projects")


ROOT = projects_root()
FIELDS = {
    "input": "input_tokens",
    "output": "output_tokens",
    "cacheRead": "cache_read_input_tokens",
    "cacheWrite": "cache_creation_input_tokens",
}


def local_moment(stamp):
    """The local time a transcript timestamp names, or None when it does not read as a time."""
    try:
        when = datetime.datetime.fromisoformat(stamp.replace("Z", "+00:00"))
    except ValueError:
        return None
    return when.astimezone()


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


def sessions_in_ranges(session_days, today):
    """How many sessions had usage in the last 7 days, the last 30 days, and all time up to today.

    Day keys are ISO dates, so comparing them as text compares the days themselves."""
    end = today.isoformat()
    starts = {
        "week": (today - datetime.timedelta(days=6)).isoformat(),
        "month": (today - datetime.timedelta(days=29)).isoformat(),
        "all": "",
    }
    return {
        name: len({owner for day, owners in session_days.items() if start <= day <= end for owner in owners})
        for name, start in starts.items()
    }


def read_transcript(path, root=ROOT):
    """The usage records one transcript holds, in the order its lines come. Each record is the response's message id,
    the local day and hour it was written at, its model, its four token counts in FIELDS order, and the session it
    counts toward (None for a file in neither place). Only lines that read as a response's usage are kept."""
    owner = owning_session(path, root)
    records = []
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
            moment = local_moment(stamp)
            if moment is None:
                continue
            model = message.get("model")
            if not isinstance(model, str) or not model:
                model = "unknown"
            counts = [count(usage.get(field)) for field in FIELDS.values()]
            records.append([message_id, moment.date().isoformat(), moment.hour, model, *counts, owner])
    return records


def file_stamp(path):
    """A transcript's size and modification time, which a read of it is valid for; None when it cannot be read."""
    try:
        status = os.stat(path)
    except OSError:
        return None
    return [status.st_size, status.st_mtime_ns]


def valid_record(record):
    """Whether a cached record has the shape read_transcript gives one."""
    if not isinstance(record, list) or len(record) != 9:
        return False
    message_id, day, hour, model, *counts, owner = record
    return (
        isinstance(message_id, str)
        and isinstance(day, str)
        and isinstance(hour, int)
        and isinstance(model, str)
        and all(isinstance(value, int) for value in counts)
        and (owner is None or isinstance(owner, str))
    )


def load_cache(path):
    """The files a previous scan saved, as {path: {"stamp": [size, mtime_ns], "records": [...]}}. A file that is
    missing, unreadable, from another version, or not shaped as a cache gives an empty one; an entry that is not
    shaped as a file's entry is left out, so its transcript is read again."""
    try:
        with open(path, encoding="utf-8") as handle:
            data = json.load(handle)
    except (OSError, ValueError):
        return {}
    if not isinstance(data, dict) or data.get("version") != CACHE_VERSION or not isinstance(data.get("files"), dict):
        return {}
    files = {}
    for file, entry in data["files"].items():
        if (
            isinstance(entry, dict)
            and isinstance(entry.get("stamp"), list)
            and isinstance(entry.get("records"), list)
            and all(valid_record(record) for record in entry["records"])
        ):
            files[file] = entry
    return files


def save_cache(path, files):
    """Saves the cache beside its place, then moves it into place, so a reader never sees half of one. A cache that cannot
    be written is left out: the next scan reads every transcript again."""
    temp = f"{path}.{os.getpid()}.tmp"
    try:
        os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
        with open(temp, "w", encoding="utf-8") as handle:
            json.dump({"version": CACHE_VERSION, "files": files}, handle)
        os.replace(temp, path)
    except OSError:
        try:
            os.remove(temp)
        except OSError:
            pass


def summarize(paths, root=ROOT, today=None, cache=None):
    """The sessions in each range and the per-day tokens of the given transcripts, read in sorted order.

    The cache, when given, maps each transcript's path to its stamp and records, as load_cache gives them. A transcript
    whose stamp has not moved keeps its records, and one that has moved is read again; the cache is updated in place,
    and a path that is no longer among the transcripts leaves it."""
    cache = {} if cache is None else cache
    wanted = set(paths)
    for path in [path for path in cache if path not in wanted]:
        del cache[path]
    records = []
    for path in sorted(paths):
        stamp = file_stamp(path)
        if stamp is None:
            cache.pop(path, None)
            continue
        entry = cache.get(path)
        if entry is None or entry["stamp"] != stamp:
            entry = {"stamp": stamp, "records": read_transcript(path, root)}
            cache[path] = entry
        records.extend(entry["records"])

    seen = set()
    session_days = {}
    days = {}
    hours = {}
    for record in records:
        message_id, day, hour, model, *counts, owner = record
        # A session counts once a day, however many of its transcripts had usage that day, so the
        # count does not depend on the file order.
        if owner is not None:
            session_days.setdefault(day, set()).add(owner)
        if message_id in seen:
            continue
        seen.add(message_id)
        tally = days.setdefault(day, {}).setdefault(model, dict.fromkeys(FIELDS, 0))
        for key, value in zip(FIELDS, counts):
            tally[key] += value
        # The same response, counted once, at the hour it was written in local time.
        hours.setdefault(day, [0] * 24)[hour] += sum(counts)
    return {
        "root": root,
        "sessions": sessions_in_ranges(session_days, today or datetime.date.today()),
        "days": days,
        "hours": hours,
    }


def cache_path_from(args):
    """The path after --cache, or None when the flag is not given or has no path after it."""
    if "--cache" not in args:
        return None
    index = args.index("--cache") + 1
    return args[index] if index < len(args) else None


def main():
    cache_path = cache_path_from(sys.argv[1:])
    files = load_cache(cache_path) if cache_path else {}
    paths = glob.glob(os.path.join(ROOT, "**", "*.jsonl"), recursive=True)
    result = summarize(paths, cache=files)
    if cache_path:
        save_cache(cache_path, files)
    json.dump(result, sys.stdout)


if __name__ == "__main__":
    main()
