"""SQLite storage and the board the desk renders."""

from __future__ import annotations

import json
import os
import sqlite3
import threading
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

TZ = ZoneInfo("Asia/Shanghai")
ROOT = Path(__file__).resolve().parents[1]
WEEKDAYS = "一二三四五六日"
THEMES = {"paper", "stone", "ink"}
DEFAULT_RULES = {
    "inbox_nudge_days": 3,
    "hold_nudge_days": 14,
    "postpone_limit": 5,
    "wait_nudge_days": 3,
    "goal_slots": 3,
}

_lock = threading.Lock()
_conn: sqlite3.Connection | None = None


class DeskError(Exception):
    pass


def now() -> datetime:
    return datetime.now(TZ)


def today() -> date:
    return now().date()


def stamp(moment: datetime | None = None) -> str:
    return (moment or now()).isoformat(timespec="seconds")


def week_start(day: date) -> date:
    return day - timedelta(days=day.weekday())


def zh_date(day: date, anchor: date) -> str:
    if day == anchor:
        return "今天"
    if day == anchor + timedelta(days=1):
        return "明天"
    if day == anchor - timedelta(days=1):
        return "昨天"
    if day.year == anchor.year:
        return f"{day.month}月{day.day}日"
    return f"{day.year}年{day.month}月{day.day}日"


def parse_date(value: str, label: str) -> date:
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError as exc:
        raise DeskError(f"{label}不是有效日期") from exc


def parse_time(value: str) -> str:
    parts = str(value or "").strip().split(":")
    if len(parts) < 2:
        raise DeskError("时间要写成 09:30 这样")
    try:
        hour, minute = int(parts[0]), int(parts[1])
    except ValueError as exc:
        raise DeskError("时间要写成 09:30 这样") from exc
    if not (0 <= hour <= 23 and 0 <= minute <= 59):
        raise DeskError("时间要写成 09:30 这样")
    return f"{hour:02d}:{minute:02d}"


def clean_text(value: str, limit: int, label: str) -> str:
    text = str(value or "").strip()
    if not text:
        raise DeskError(f"先写{label}")
    if len(text) > limit:
        raise DeskError(f"{label}太长了")
    return text


def clip(value: str, limit: int) -> str:
    return str(value or "").strip()[:limit]


def rules() -> dict:
    data = dict(DEFAULT_RULES)
    path = Path(os.environ.get("DAYDESK_PROFILE", ROOT / "profile" / "default.json"))
    try:
        loaded = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return data
    if not isinstance(loaded, dict):
        return data
    for key in DEFAULT_RULES:
        if key not in loaded:
            continue
        try:
            value = int(loaded[key])
        except (TypeError, ValueError):
            continue
        if value > 0:
            data[key] = value
    return data


def configure(db_path: str) -> None:
    global _conn
    with _lock:
        if _conn is not None:
            _conn.close()
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(db_path, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        conn.execute("PRAGMA journal_mode = WAL")
        _migrate(conn)
        conn.commit()
        _conn = conn


def close() -> None:
    global _conn
    with _lock:
        if _conn is not None:
            _conn.close()
            _conn = None


def connection() -> sqlite3.Connection:
    if _conn is None:
        raise RuntimeError("database is not ready")
    return _conn


def write(fn):
    with _lock:
        conn = connection()
        try:
            result = fn(conn)
            conn.commit()
            return result
        except Exception:
            conn.rollback()
            raise


def read(fn):
    with _lock:
        return fn(connection())


def _migrate(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS profile (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          title TEXT NOT NULL,
          note TEXT NOT NULL,
          theme TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS goals (
          id INTEGER PRIMARY KEY,
          week_start TEXT NOT NULL,
          title TEXT NOT NULL,
          position INTEGER NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS todos (
          id INTEGER PRIMARY KEY,
          title TEXT NOT NULL,
          due_date TEXT,
          priority TEXT NOT NULL,
          status TEXT NOT NULL,
          goal_id INTEGER REFERENCES goals(id),
          postpone_count INTEGER NOT NULL DEFAULT 0,
          waiting_since TEXT,
          source TEXT NOT NULL,
          created_at TEXT NOT NULL,
          done_at TEXT,
          dropped_at TEXT
        );
        CREATE TABLE IF NOT EXISTS sparks (
          id INTEGER PRIMARY KEY,
          text TEXT NOT NULL,
          status TEXT NOT NULL,
          created_at TEXT NOT NULL,
          held_at TEXT,
          settled_at TEXT,
          outcome TEXT,
          title TEXT NOT NULL DEFAULT '',
          origin TEXT NOT NULL DEFAULT '',
          outline TEXT NOT NULL DEFAULT '',
          body TEXT NOT NULL DEFAULT '',
          hypothesis TEXT NOT NULL DEFAULT '',
          smallest_step TEXT NOT NULL DEFAULT '',
          result TEXT NOT NULL DEFAULT '',
          todo_id INTEGER
        );
        CREATE TABLE IF NOT EXISTS blocks (
          id INTEGER PRIMARY KEY,
          day TEXT NOT NULL,
          start_time TEXT NOT NULL,
          end_time TEXT NOT NULL,
          title TEXT NOT NULL,
          todo_id INTEGER,
          created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS routines (
          id INTEGER PRIMARY KEY,
          weekday INTEGER NOT NULL,
          start_time TEXT NOT NULL,
          end_time TEXT NOT NULL,
          title TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS daily_reviews (
          id INTEGER PRIMARY KEY,
          day TEXT NOT NULL UNIQUE,
          blocker TEXT NOT NULL,
          next1 TEXT NOT NULL,
          next2 TEXT NOT NULL,
          next3 TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS daily_dispositions (
          id INTEGER PRIMARY KEY,
          review_id INTEGER NOT NULL REFERENCES daily_reviews(id),
          todo_id INTEGER NOT NULL,
          action TEXT NOT NULL,
          reschedule_date TEXT,
          UNIQUE(review_id, todo_id)
        );
        CREATE TABLE IF NOT EXISTS weekly_reviews (
          id INTEGER PRIMARY KEY,
          week_start TEXT NOT NULL UNIQUE,
          created_at TEXT NOT NULL
        );
        """
    )
    conn.execute(
        "INSERT OR IGNORE INTO profile (id, title, note, theme) VALUES (1, 'Daydesk', '', 'paper')"
    )


def _insert_todo(conn, title, due, goal_id, priority, waiting, source) -> int:
    moment = stamp()
    if goal_id is not None:
        goal = conn.execute("SELECT week_start FROM goals WHERE id = ?", (goal_id,)).fetchone()
        if goal is None or goal["week_start"] != week_start(today()).isoformat():
            raise DeskError("这个目标不是本周的")
    conn.execute(
        """
        INSERT INTO todos (
          title, due_date, priority, status, goal_id, postpone_count,
          waiting_since, source, created_at
        ) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)
        """,
        (
            title,
            due,
            priority,
            "waiting" if waiting else "open",
            goal_id,
            moment if waiting else None,
            source,
            moment,
        ),
    )
    return int(conn.execute("SELECT last_insert_rowid()").fetchone()[0])


def _todo_or_raise(conn, todo_id: int):
    row = conn.execute("SELECT * FROM todos WHERE id = ?", (todo_id,)).fetchone()
    if row is None:
        raise DeskError("这条待办不在")
    return row


def _ensure_postpone(todo, rule: dict) -> None:
    if todo["postpone_count"] >= rule["postpone_limit"]:
        raise DeskError(
            f"「{todo['title']}」已经顺延满 {rule['postpone_limit']} 次，只能做掉或放弃"
        )


def create_todo(title: str, due_date: str | None, goal_id: int | None, priority: str, waiting: bool) -> dict:
    title = clean_text(title, 120, "待办")
    if priority not in ("normal", "high"):
        raise DeskError("优先级不对")
    due = parse_date(due_date, "截止日期").isoformat() if due_date else None

    def op(conn):
        _insert_todo(conn, title, due, goal_id, priority, waiting, "manual")

    write(op)
    return board()


def finish_todo(todo_id: int) -> dict:
    def op(conn):
        todo = _todo_or_raise(conn, todo_id)
        if todo["status"] == "dropped":
            raise DeskError("这条已经删掉了")
        if todo["status"] != "done":
            conn.execute(
                "UPDATE todos SET status = 'done', done_at = ? WHERE id = ?",
                (stamp(), todo_id),
            )

    write(op)
    return board()


def postpone_todo(todo_id: int) -> dict:
    rule = rules()

    def op(conn):
        todo = _todo_or_raise(conn, todo_id)
        if todo["status"] != "open":
            raise DeskError("这条不用再顺延")
        _ensure_postpone(todo, rule)
        conn.execute(
            "UPDATE todos SET due_date = ?, postpone_count = postpone_count + 1 WHERE id = ?",
            ((today() + timedelta(days=1)).isoformat(), todo_id),
        )

    write(op)
    return board()


def drop_todo(todo_id: int) -> dict:
    def op(conn):
        todo = _todo_or_raise(conn, todo_id)
        if todo["status"] == "done":
            raise DeskError("已经做完的不用删")
        conn.execute(
            "UPDATE todos SET status = 'dropped', dropped_at = ? WHERE id = ?",
            (stamp(), todo_id),
        )

    write(op)
    return board()


def set_goals(day: date, titles: list[str]) -> None:
    rule = rules()
    cleaned = [str(item or "").strip() for item in titles if str(item or "").strip()]
    if not cleaned:
        raise DeskError("至少写一个要交出去的结果")
    if len(cleaned) > rule["goal_slots"]:
        raise DeskError(f"一周最多 {rule['goal_slots']} 个要交出去的结果")
    for title in cleaned:
        if len(title) > 80:
            raise DeskError("目标太长了")
    start = week_start(day).isoformat()

    def op(conn):
        rows = conn.execute(
            "SELECT id FROM goals WHERE week_start = ? ORDER BY position, id",
            (start,),
        ).fetchall()
        for index, title in enumerate(cleaned):
            if index < len(rows):
                conn.execute("UPDATE goals SET title = ? WHERE id = ?", (title, rows[index]["id"]))
            else:
                conn.execute(
                    "INSERT INTO goals (week_start, title, position, created_at) VALUES (?, ?, ?, ?)",
                    (start, title, index, stamp()),
                )
        extra = [rows[index]["id"] for index in range(len(cleaned), len(rows))]
        if not extra:
            return
        marks = ",".join("?" for _ in extra)
        linked = conn.execute(
            f"SELECT COUNT(*) AS n FROM todos WHERE goal_id IN ({marks}) AND status != 'dropped'",
            extra,
        ).fetchone()["n"]
        if linked:
            raise DeskError("有待办还挂在要拿掉的目标上，先改挂或做完")
        conn.execute(f"DELETE FROM goals WHERE id IN ({marks})", extra)

    write(op)


def save_current_goals(titles: list[str]) -> dict:
    set_goals(today(), titles)
    return board()


def save_next_goals(titles: list[str]) -> dict:
    nxt = week_start(today()) + timedelta(days=7)
    set_goals(nxt, titles)

    def op(conn):
        start = week_start(today()).isoformat()
        conn.execute(
            "INSERT OR IGNORE INTO weekly_reviews (week_start, created_at) VALUES (?, ?)",
            (start, stamp()),
        )

    write(op)
    return board()


def add_spark(text: str) -> dict:
    text = clean_text(text, 140, "灵感")

    def op(conn):
        conn.execute(
            "INSERT INTO sparks (text, status, created_at) VALUES (?, 'inbox', ?)",
            (text, stamp()),
        )

    write(op)
    return board()


def flow_spark(spark_id: int, action: str, fields: dict) -> dict:
    def op(conn):
        row = conn.execute("SELECT * FROM sparks WHERE id = ?", (spark_id,)).fetchone()
        if row is None:
            raise DeskError("这条灵感不在")
        if row["status"] not in ("inbox", "hold"):
            raise DeskError("这条灵感已经选过去向")
        moment = stamp()
        if action == "hold":
            conn.execute(
                "UPDATE sparks SET status = 'hold', held_at = ? WHERE id = ?",
                (moment, spark_id),
            )
            return
        if action == "todo":
            todo_id = _insert_todo(conn, row["text"], None, None, "normal", False, "spark")
            conn.execute(
                """
                UPDATE sparks
                SET status = 'settled', outcome = 'todo', settled_at = ?, todo_id = ?
                WHERE id = ?
                """,
                (moment, todo_id, spark_id),
            )
            return
        if action == "write":
            origin = clip(fields.get("origin") or row["text"], 200) or row["text"]
            title = clip(fields.get("title") or origin[:28], 80) or origin[:28]
            conn.execute(
                """
                UPDATE sparks
                SET status = 'writing', title = ?, origin = ?, outline = ?, body = ?
                WHERE id = ?
                """,
                (title, origin, clip(fields.get("outline"), 500), clip(fields.get("body"), 20000), spark_id),
            )
            return
        if action == "try":
            step = clip(fields.get("smallest_step"), 120)
            if not step:
                raise DeskError("先写本周能做完的最小一步")
            hypothesis = clip(fields.get("hypothesis") or row["text"], 200) or row["text"]
            todo_id = _insert_todo(conn, step, today().isoformat(), None, "normal", False, "spark")
            conn.execute(
                """
                UPDATE sparks
                SET status = 'practice', hypothesis = ?, smallest_step = ?, title = ?, todo_id = ?
                WHERE id = ?
                """,
                (hypothesis, step, clip(row["text"], 28), todo_id, spark_id),
            )
            return
        raise DeskError("没有这条去向")

    write(op)
    return board()


def update_spark(spark_id: int, fields: dict) -> dict:
    settle = bool(fields.get("settle"))

    def op(conn):
        row = conn.execute("SELECT * FROM sparks WHERE id = ?", (spark_id,)).fetchone()
        if row is None:
            raise DeskError("这条灵感不在")
        moment = stamp()
        if row["status"] == "writing":
            title = clip(fields.get("title") if fields.get("title") is not None else row["title"], 80)
            origin = clip(fields.get("origin") if fields.get("origin") is not None else row["origin"], 200)
            outline = clip(fields.get("outline") if fields.get("outline") is not None else row["outline"], 500)
            body = clip(fields.get("body") if fields.get("body") is not None else row["body"], 20000)
            if settle and not body:
                raise DeskError("先写一段正文，再标成写完")
            status = "settled" if settle else "writing"
            conn.execute(
                """
                UPDATE sparks
                SET title = ?, origin = ?, outline = ?, body = ?, status = ?,
                    outcome = ?, settled_at = ?
                WHERE id = ?
                """,
                (
                    title or origin[:28] or row["text"][:28],
                    origin,
                    outline,
                    body,
                    status,
                    "article" if settle else None,
                    moment if settle else None,
                    spark_id,
                ),
            )
            return
        if row["status"] == "practice":
            result = clip(fields.get("result") if fields.get("result") is not None else row["result"], 2000)
            if settle and not result:
                raise DeskError("先记下这次的结果")
            conn.execute(
                "UPDATE sparks SET result = ?, status = ?, outcome = ?, settled_at = ? WHERE id = ?",
                (
                    result,
                    "settled" if settle else "practice",
                    "practice" if settle else None,
                    moment if settle else None,
                    spark_id,
                ),
            )
            if settle and row["todo_id"]:
                conn.execute(
                    """
                    UPDATE todos SET status = 'done', done_at = ?
                    WHERE id = ? AND status IN ('open', 'waiting')
                    """,
                    (moment, row["todo_id"]),
                )
            return
        raise DeskError("这条现在不能改")

    write(op)
    return board()


def add_block(
    day: str,
    start: str,
    end: str,
    title: str,
    todo_id: int | None,
    repeat: bool = False,
) -> dict:
    day_value = parse_date(day, "日期")
    start_value = parse_time(start)
    end_value = parse_time(end)
    if end_value <= start_value:
        raise DeskError("结束要晚于开始")
    title = clean_text(title, 80, "安排")
    start_day = week_start(today())
    if not (start_day <= day_value <= start_day + timedelta(days=6)):
        raise DeskError("只能排这一周的时间")

    def op(conn):
        if repeat:
            conn.execute(
                """
                INSERT INTO routines (weekday, start_time, end_time, title, created_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (day_value.weekday(), start_value, end_value, title, stamp()),
            )
            return
        if todo_id is not None:
            todo = conn.execute(
                "SELECT id FROM todos WHERE id = ? AND status IN ('open', 'waiting')",
                (todo_id,),
            ).fetchone()
            if todo is None:
                raise DeskError("要挂的待办不在")
        conn.execute(
            """
            INSERT INTO blocks (day, start_time, end_time, title, todo_id, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (day_value.isoformat(), start_value, end_value, title, todo_id, stamp()),
        )

    write(op)
    return board()


def delete_block(block_id: int) -> dict:
    def op(conn):
        conn.execute("DELETE FROM blocks WHERE id = ?", (block_id,))

    write(op)
    return board()


def delete_routine(routine_id: int) -> dict:
    def op(conn):
        conn.execute("DELETE FROM routines WHERE id = ?", (routine_id,))

    write(op)
    return board()


def save_daily(blocker: str, nxt: list[str], items: list[dict]) -> dict:
    rule = rules()
    blocker = clip(blocker, 500)
    values = [clip(item, 120) for item in (nxt or [])]
    while len(values) < 3:
        values.append("")
    values = values[:3]
    day = today().isoformat()

    def op(conn):
        existing = conn.execute("SELECT id FROM daily_reviews WHERE day = ?", (day,)).fetchone()
        if existing:
            review_id = existing["id"]
            conn.execute(
                "UPDATE daily_reviews SET blocker = ?, next1 = ?, next2 = ?, next3 = ? WHERE id = ?",
                (blocker, values[0], values[1], values[2], review_id),
            )
        else:
            conn.execute(
                """
                INSERT INTO daily_reviews (day, blocker, next1, next2, next3, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (day, blocker, values[0], values[1], values[2], stamp()),
            )
            review_id = int(conn.execute("SELECT last_insert_rowid()").fetchone()[0])
        for item in items:
            todo = conn.execute("SELECT * FROM todos WHERE id = ?", (item["todo_id"],)).fetchone()
            if todo is None or todo["status"] != "open":
                continue
            seen = conn.execute(
                "SELECT 1 FROM daily_dispositions WHERE review_id = ? AND todo_id = ?",
                (review_id, todo["id"]),
            ).fetchone()
            if seen:
                continue
            action = item.get("action")
            if action == "tomorrow":
                _ensure_postpone(todo, rule)
                conn.execute(
                    "UPDATE todos SET due_date = ?, postpone_count = postpone_count + 1 WHERE id = ?",
                    ((today() + timedelta(days=1)).isoformat(), todo["id"]),
                )
            elif action == "reschedule":
                _ensure_postpone(todo, rule)
                new_day = parse_date(item.get("date") or "", "改期")
                if new_day <= today():
                    raise DeskError("改期要选今天之后的日期")
                conn.execute(
                    "UPDATE todos SET due_date = ? WHERE id = ?",
                    (new_day.isoformat(), todo["id"]),
                )
            elif action == "drop":
                conn.execute(
                    "UPDATE todos SET status = 'dropped', dropped_at = ? WHERE id = ?",
                    (stamp(), todo["id"]),
                )
            else:
                raise DeskError("处理方式不对")
            conn.execute(
                """
                INSERT INTO daily_dispositions (review_id, todo_id, action, reschedule_date)
                VALUES (?, ?, ?, ?)
                """,
                (review_id, todo["id"], action, item.get("date")),
            )

    write(op)
    return board()


def save_profile(title: str, note: str, theme: str) -> dict:
    title = clean_text(title, 24, "标题")
    note = clip(note, 32)
    if theme not in THEMES:
        raise DeskError("配色要在纸本、青石、墨蓝里选")

    def op(conn):
        conn.execute(
            "UPDATE profile SET title = ?, note = ?, theme = ? WHERE id = 1",
            (title, note, theme),
        )

    write(op)
    return board()


def _flags(todo, anchor: date, rule: dict) -> list[dict]:
    flags = []
    due = date.fromisoformat(todo["due_date"]) if todo["due_date"] else None
    if todo["status"] == "done":
        flags.append({"tone": "ok", "text": "已完成"})
    if todo["status"] == "open" and due and due < anchor:
        flags.append({"tone": "danger", "text": f"逾期 {(anchor - due).days} 天"})
    if todo["postpone_count"]:
        tone = "danger" if todo["postpone_count"] >= rule["postpone_limit"] else "warn"
        flags.append({"tone": tone, "text": f"已顺延 {todo['postpone_count']} 次"})
    if todo["status"] == "waiting" and todo["waiting_since"]:
        waited = (anchor - date.fromisoformat(todo["waiting_since"][:10])).days
        flags.append({"tone": "warn", "text": f"等待别人 {waited} 天"})
    if todo["priority"] == "high" and todo["status"] != "done":
        flags.append({"tone": "", "text": "高"})
    return flags


def _actions(todo, anchor: date, rule: dict) -> list[str]:
    if todo["status"] == "waiting":
        return ["wait", "done"]
    if todo["status"] != "open":
        return []
    due = date.fromisoformat(todo["due_date"]) if todo["due_date"] else None
    overdue = bool(due and due < anchor)
    if todo["postpone_count"] >= rule["postpone_limit"]:
        return ["done", "drop"]
    if overdue or todo["postpone_count"]:
        return ["postpone", "done"]
    return ["done"]


def _kind(todo, anchor: date) -> str:
    if todo["status"] == "done":
        return "done"
    if todo["status"] == "waiting":
        return "wait"
    due = date.fromisoformat(todo["due_date"]) if todo["due_date"] else None
    if due and due < anchor:
        return "late"
    if due == anchor:
        return "today"
    return "open"


def _meta(todo, goal_title: str, anchor: date) -> list[str]:
    if todo["status"] == "done" and todo["done_at"]:
        done = datetime.fromisoformat(todo["done_at"])
        parts = [f"{zh_date(done.date(), anchor)} {done.strftime('%H:%M')}"]
        if goal_title:
            parts.append(goal_title)
        return parts
    parts = [zh_date(date.fromisoformat(todo["due_date"]), anchor) if todo["due_date"] else "未定日期"]
    if goal_title:
        parts.append(goal_title)
    if todo["source"] == "spark":
        parts.append("从灵感转来")
    return parts


def _public_todo(todo, goal_title: str, anchor: date, rule: dict) -> dict:
    return {
        "id": todo["id"],
        "title": todo["title"],
        "due_date": todo["due_date"],
        "priority": todo["priority"],
        "status": todo["status"],
        "goal_id": todo["goal_id"],
        "goal_title": goal_title,
        "postpone_count": todo["postpone_count"],
        "source": todo["source"],
        "kind": _kind(todo, anchor),
        "meta": _meta(todo, goal_title, anchor),
        "flags": _flags(todo, anchor, rule),
        "actions": _actions(todo, anchor, rule),
    }


def _age(start: str, anchor: date) -> int:
    return (anchor - date.fromisoformat(start[:10])).days


def _public_spark(row, anchor: date, rule: dict) -> dict:
    age = _age(row["held_at"] or row["created_at"], anchor)
    if row["status"] == "inbox" and age == 0:
        created = datetime.fromisoformat(row["created_at"])
        meta = f"今天 {created.strftime('%H:%M')}"
    elif row["status"] == "inbox":
        meta = f"{zh_date(date.fromisoformat(row['created_at'][:10]), anchor)} · 已放 {age} 天"
    elif row["status"] == "hold":
        meta = f"培育 {age} 天"
    elif row["status"] == "writing":
        meta = "构思" + (f" · 出发点：{row['origin']}" if row["origin"] else "")
    elif row["status"] == "practice":
        meta = "最小一步：" + (row["smallest_step"] or "还没写")
    elif row["outcome"] == "article":
        meta = "已成文"
    elif row["outcome"] == "practice":
        meta = "已实践"
    else:
        meta = ""
    aged = (row["status"] == "inbox" and age >= rule["inbox_nudge_days"]) or (
        row["status"] == "hold" and age >= rule["hold_nudge_days"]
    )
    return {
        "id": row["id"],
        "text": row["text"],
        "status": row["status"],
        "title": row["title"] or row["text"],
        "origin": row["origin"],
        "outline": row["outline"],
        "body": row["body"],
        "hypothesis": row["hypothesis"],
        "smallest_step": row["smallest_step"],
        "result": row["result"],
        "outcome": row["outcome"],
        "age_days": age,
        "aged": aged,
        "meta": meta,
    }


def _lines(items: list[str]) -> str:
    cleaned = [item for item in items if item]
    if not cleaned:
        return "没有。"
    return "\n".join(f"- {item}" for item in cleaned)


def _report(done: list[str], gaps: list[str], blockers: list[str], nxt: list[str]) -> str:
    return "\n\n".join(
        [
            "一、本周完成\n" + _lines(done),
            "二、目标差距\n" + _lines(gaps),
            "三、问题\n" + _lines(blockers),
            "四、下周重点\n" + _lines(nxt),
        ]
    )


def _in_span(value: str | None, start: date, end: date) -> bool:
    if not value:
        return False
    day = date.fromisoformat(value[:10])
    return start <= day <= end


def board() -> dict:
    rule = rules()
    anchor = today()
    start = week_start(anchor)
    end = start + timedelta(days=6)
    moment = now()

    def op(conn):
        profile = conn.execute("SELECT title, note, theme FROM profile WHERE id = 1").fetchone()
        all_goals = conn.execute("SELECT id, title FROM goals").fetchall()
        goals = conn.execute(
            "SELECT * FROM goals WHERE week_start = ? ORDER BY position, id",
            (start.isoformat(),),
        ).fetchall()
        next_goals = conn.execute(
            "SELECT title FROM goals WHERE week_start = ? ORDER BY position, id",
            ((start + timedelta(days=7)).isoformat(),),
        ).fetchall()
        todos = conn.execute("SELECT * FROM todos ORDER BY id DESC").fetchall()
        sparks = conn.execute("SELECT * FROM sparks ORDER BY id DESC").fetchall()
        blocks = conn.execute(
            "SELECT * FROM blocks WHERE day >= ? AND day <= ? ORDER BY day, start_time, id",
            (start.isoformat(), end.isoformat()),
        ).fetchall()
        routines = conn.execute(
            "SELECT * FROM routines ORDER BY weekday, start_time, id"
        ).fetchall()
        reviews = conn.execute(
            "SELECT * FROM daily_reviews WHERE day >= ? AND day <= ?",
            (start.isoformat(), end.isoformat()),
        ).fetchall()
        yesterday = conn.execute(
            "SELECT next1, next2, next3 FROM daily_reviews WHERE day = ?",
            ((anchor - timedelta(days=1)).isoformat(),),
        ).fetchone()
        saved = conn.execute("SELECT * FROM daily_reviews WHERE day = ?", (anchor.isoformat(),)).fetchone()
        return profile, all_goals, goals, next_goals, todos, sparks, blocks, routines, reviews, yesterday, saved

    profile, all_goals, goals, next_goals, todos, sparks, blocks, routines, reviews, yesterday, saved = read(op)
    goal_titles = {row["id"]: row["title"] for row in all_goals}
    visible = []
    for todo in todos:
        if todo["status"] == "dropped":
            continue
        if todo["status"] == "done" and not _in_span(todo["done_at"], start, end):
            continue
        visible.append(_public_todo(todo, goal_titles.get(todo["goal_id"], ""), anchor, rule))

    open_todos = [todo for todo in visible if todo["status"] == "open"]
    pinned = []
    if yesterday:
        used = set()
        for title in (yesterday["next1"], yesterday["next2"], yesterday["next3"]):
            title = (title or "").strip()
            if not title:
                continue
            for todo in open_todos:
                if todo["id"] in used or todo["title"] != title:
                    continue
                pinned.append(todo)
                used.add(todo["id"])
                break
    rest = [todo for todo in open_todos if todo not in pinned]
    rest.sort(key=lambda todo: _rank(todo, anchor))
    top = (pinned + rest)[:3]
    risks = [todo for todo in visible if _is_risk(todo, anchor, rule)]
    risks.sort(key=lambda todo: _risk_rank(todo))

    public_sparks = [_public_spark(row, anchor, rule) for row in sparks]
    by_status = {
        "inbox": [row for row in public_sparks if row["status"] == "inbox"],
        "hold": [row for row in public_sparks if row["status"] == "hold"],
        "writing": [row for row in public_sparks if row["status"] == "writing"],
        "practice": [row for row in public_sparks if row["status"] == "practice"],
    }
    settled = []
    spark_by_id = {row["id"]: row for row in sparks}
    for item in public_sparks:
        raw = spark_by_id[item["id"]]
        if item["status"] == "settled" and item["outcome"] in ("article", "practice") and _in_span(raw["settled_at"], start, end):
            settled.append(item)
    by_status["settled"] = settled

    goal_cards = []
    gaps = []
    for goal in goals:
        linked = [todo for todo in todos if todo["goal_id"] == goal["id"] and todo["status"] != "dropped"]
        done_count = len([todo for todo in linked if todo["status"] == "done"])
        open_count = len([todo for todo in linked if todo["status"] in ("open", "waiting")])
        percent = round(100 * done_count / len(linked)) if linked else 0
        if not linked:
            line = "还没有挂上待办"
            gap = f"{goal['title']}，还没有挂上待办"
        elif open_count == 0:
            line = "已经做完"
            gap = f"{goal['title']}，已经做完"
        else:
            line = f"还剩 {open_count} 件待办"
            gap = f"{goal['title']}，现在 {percent}%，{line}"
        goal_cards.append(
            {
                "id": goal["id"],
                "title": goal["title"],
                "percent": percent,
                "line": line,
            }
        )
        gaps.append(gap)

    done_titles = []
    for todo in todos:
        if todo["status"] == "done" and _in_span(todo["done_at"], start, end):
            done_titles.append(todo["title"])
    for item in settled:
        prefix = "已成文" if item["outcome"] == "article" else "已实践"
        done_titles.append(f"{prefix}：{item['title']}")

    blockers = []
    for review in reviews:
        text = (review["blocker"] or "").strip()
        if text and text not in blockers:
            blockers.append(text)

    today_done = []
    for todo in todos:
        if todo["status"] == "done" and todo["done_at"] and todo["done_at"][:10] == anchor.isoformat():
            goal_name = goal_titles.get(todo["goal_id"], "")
            today_done.append(
                {
                    "title": todo["title"],
                    "goal_title": goal_name,
                }
            )
    unfinished = [todo for todo in open_todos if _due_or_undated(todo, anchor)]
    aged_inbox = [item for item in by_status["inbox"] if item["aged"]]
    aged_hold = [item for item in by_status["hold"] if item["aged"]]

    block_titles = {}
    for row in todos:
        block_titles[row["id"]] = row["title"]
    day_blocks = { (start + timedelta(days=offset)).isoformat(): [] for offset in range(7) }
    for row in blocks:
        day_blocks[row["day"]].append(
            {
                "id": row["id"],
                "start": row["start_time"],
                "end": row["end_time"],
                "title": row["title"],
                "todo_title": block_titles.get(row["todo_id"], ""),
                "weekly": False,
            }
        )
    for row in routines:
        for offset in range(7):
            day = start + timedelta(days=offset)
            if day.weekday() != row["weekday"]:
                continue
            day_blocks[day.isoformat()].append(
                {
                    "id": row["id"],
                    "start": row["start_time"],
                    "end": row["end_time"],
                    "title": row["title"],
                    "todo_title": "",
                    "weekly": True,
                }
            )
    for items in day_blocks.values():
        items.sort(key=lambda item: (item["start"], 0 if item["weekly"] else 1, item["id"]))
    days = []
    for offset in range(7):
        day = start + timedelta(days=offset)
        items = day_blocks[day.isoformat()]
        days.append(
            {
                "date": day.isoformat(),
                "weekday": f"周{WEEKDAYS[day.weekday()]}",
                "day": day.day,
                "is_today": day == anchor,
                "summary": " · ".join(item["title"] for item in items) if items else "没有安排",
                "blocks": items,
            }
        )

    next_titles = [row["title"] for row in next_goals]
    week_no = anchor.isocalendar().week
    return {
        "clock": {
            "today": anchor.isoformat(),
            "now": moment.strftime("%H:%M"),
            "weekday": f"星期{WEEKDAYS[anchor.weekday()]}",
            "week": week_no,
            "week_start": start.isoformat(),
            "week_end": end.isoformat(),
            "kicker": f"第 {week_no} 周 · 星期{WEEKDAYS[anchor.weekday()]}",
            "heading": f"{anchor.month}月{anchor.day}日",
            "schedule_kicker": f"第 {week_no} 周 · {start.month}月{start.day}日到{end.month}月{end.day}日",
        },
        "rules": rule,
        "profile": {"title": profile["title"], "note": profile["note"], "theme": profile["theme"]},
        "top3": top,
        "risks": risks,
        "todos": visible,
        "goals": goal_cards,
        "inbox": by_status["inbox"],
        "holds": by_status["hold"],
        "writing": by_status["writing"],
        "practices": by_status["practice"],
        "settled": settled,
        "days": days,
        "daily": {
            "done": today_done,
            "open": unfinished,
            "aged": aged_inbox,
            "saved": None
            if saved is None
            else {
                "blocker": saved["blocker"],
                "next": [saved["next1"], saved["next2"], saved["next3"]],
            },
        },
        "weekly": {
            "done": done_titles,
            "gaps": gaps,
            "blockers": blockers,
            "aged": aged_hold,
            "next_goals": next_titles,
            "report": _report(done_titles, gaps, blockers, next_titles),
        },
    }


def _rank(todo: dict, anchor: date):
    due = date.fromisoformat(todo["due_date"]) if todo["due_date"] else None
    return (
        0 if due and due < anchor else 1,
        0 if todo["priority"] == "high" else 1,
        0 if due == anchor else 1,
        due.toordinal() if due else 999999,
        todo["id"],
    )


def _due_or_undated(todo: dict, anchor: date) -> bool:
    if not todo["due_date"]:
        return True
    return date.fromisoformat(todo["due_date"]) <= anchor


def _is_risk(todo: dict, anchor: date, rule: dict) -> bool:
    if todo["status"] == "open" and todo["due_date"] and date.fromisoformat(todo["due_date"]) < anchor:
        return True
    if todo["status"] == "open" and todo["postpone_count"] >= rule["postpone_limit"]:
        return True
    if todo["status"] == "waiting":
        flag = next((item for item in todo["flags"] if item["text"].startswith("等待别人")), None)
        if flag:
            days = int(flag["text"].split()[1])
            return days >= rule["wait_nudge_days"]
    return False


def _risk_rank(todo: dict):
    limit = 0 if any("顺延" in flag["text"] and flag["tone"] == "danger" for flag in todo["flags"]) else 1
    return (limit, todo["id"])
