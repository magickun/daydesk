import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("DAYDESK_DB", str(tmp_path / "daydesk.db"))
    monkeypatch.setenv("DAYDESK_TOKEN", "")
    with TestClient(app) as test_client:
        yield test_client


def test_home_is_the_desk(client):
    page = client.get("/")
    assert page.status_code == 200
    assert "记下一句灵感" in page.text
    assert "一天的桌子" not in page.text
    board = client.get("/api/board")
    assert board.status_code == 200
    body = board.json()
    assert body["profile"]["title"] == "Daydesk"
    assert body["goals"] == []
    assert body["todos"] == []


def test_todo_reaches_today_and_review(client):
    today = client.get("/api/board").json()["clock"]["today"]
    created = client.post(
        "/api/todos",
        json={"title": "写周报", "due_date": today, "priority": "high"},
    )
    assert created.status_code == 200
    body = created.json()
    assert body["top3"][0]["title"] == "写周报"
    todo_id = body["top3"][0]["id"]

    done = client.post(f"/api/todos/{todo_id}/done")
    assert done.status_code == 200
    finished = done.json()
    assert finished["top3"] == []
    assert finished["daily"]["done"][0]["title"] == "写周报"
    assert "写周报" in finished["weekly"]["done"]


def test_postpone_stops_at_the_limit(client):
    today = client.get("/api/board").json()["clock"]["today"]
    year, month, day = [int(part) for part in today.split("-")]
    from datetime import date, timedelta

    yesterday = (date(year, month, day) - timedelta(days=1)).isoformat()
    created = client.post("/api/todos", json={"title": "准备会议材料", "due_date": yesterday})
    todo_id = created.json()["risks"][0]["id"]
    for _ in range(5):
        moved = client.post(f"/api/todos/{todo_id}/postpone")
        assert moved.status_code == 200
    blocked = client.post(f"/api/todos/{todo_id}/postpone")
    assert blocked.status_code == 400
    assert "只能做掉或放弃" in blocked.json()["detail"]
    dropped = client.post(f"/api/todos/{todo_id}/drop")
    assert dropped.json()["todos"] == []


def test_spark_can_be_deleted_from_inbox(client):
    sparked = client.post("/api/sparks", json={"text": "先删掉这条"})
    spark_id = sparked.json()["inbox"][0]["id"]
    removed = client.delete(f"/api/sparks/{spark_id}")
    assert removed.status_code == 200
    assert removed.json()["inbox"] == []


def test_spark_can_become_practice(client):
    sparked = client.post("/api/sparks", json={"text": "晨会只讲三件事"})
    spark_id = sparked.json()["inbox"][0]["id"]
    moved = client.post(
        f"/api/sparks/{spark_id}/flow",
        json={"action": "try", "hypothesis": "三件事是否够用", "smallest_step": "明天晨会只列三件"},
    )
    assert moved.status_code == 200
    body = moved.json()
    assert body["inbox"] == []
    assert body["practices"][0]["smallest_step"] == "明天晨会只列三件"
    assert body["todos"][0]["title"] == "明天晨会只列三件"
    assert body["todos"][0]["source"] == "spark"


def test_weekly_goals_show_up_next_week_and_in_the_report(client):
    saved = client.put("/api/goals", json={"goals": ["把阶段文档交出去", "直播走一遍"]})
    assert saved.status_code == 200
    assert [item["title"] for item in saved.json()["goals"]] == ["把阶段文档交出去", "直播走一遍"]
    confirmed = client.post("/api/reviews/weekly", json={"goals": ["下周只留一件"]})
    body = confirmed.json()
    assert body["weekly"]["next_goals"] == ["下周只留一件"]
    assert "下周只留一件" in body["weekly"]["report"]
    assert "把阶段文档交出去" in body["weekly"]["report"]


def test_profile_renames_the_desk(client):
    saved = client.put("/api/profile", json={"title": "昆的桌子", "note": "只放今天", "theme": "stone"})
    assert saved.status_code == 200
    profile = saved.json()["profile"]
    assert profile == {"title": "昆的桌子", "note": "只放今天", "theme": "stone"}


def test_daily_review_moves_unfinished_work(client):
    today = client.get("/api/board").json()["clock"]["today"]
    created = client.post("/api/todos", json={"title": "还没做的材料", "due_date": today})
    todo_id = created.json()["todos"][0]["id"]
    saved = client.post(
        "/api/reviews/daily",
        json={
            "blocker": "材料还在等对方",
            "next": ["还没做的材料", "", ""],
            "items": [{"todo_id": todo_id, "action": "tomorrow"}],
        },
    )
    assert saved.status_code == 200
    body = saved.json()
    assert body["daily"]["saved"]["blocker"] == "材料还在等对方"
    assert body["todos"][0]["meta"][0] == "明天"
    assert "材料还在等对方" in body["weekly"]["blockers"]


def test_schedule_block_lands_on_the_chosen_day(client):
    today = client.get("/api/board").json()["clock"]["today"]
    saved = client.post(
        "/api/blocks",
        json={"day": today, "start": "10:00", "end": "11:00", "title": "写周报"},
    )
    assert saved.status_code == 200
    today_column = next(day for day in saved.json()["days"] if day["is_today"])
    assert today_column["blocks"][0]["title"] == "写周报"
    assert today_column["blocks"][0]["weekly"] is False
    removed = client.delete(f"/api/blocks/{today_column['blocks'][0]['id']}")
    column = next(day for day in removed.json()["days"] if day["is_today"])
    assert column["blocks"] == []


def test_weekly_routine_repeats_on_that_weekday(client):
    today = client.get("/api/board").json()["clock"]["today"]
    saved = client.post(
        "/api/blocks",
        json={"day": today, "start": "09:00", "end": "09:30", "title": "晨间整理", "repeat": True},
    )
    assert saved.status_code == 200
    hits = [
        day
        for day in saved.json()["days"]
        if any(block["title"] == "晨间整理" for block in day["blocks"])
    ]
    assert len(hits) == 1
    assert hits[0]["is_today"]
    block = next(item for item in hits[0]["blocks"] if item["title"] == "晨间整理")
    assert block["weekly"] is True
    missed = client.delete(f"/api/blocks/{block['id']}")
    still = next(day for day in missed.json()["days"] if day["is_today"])
    assert any(item["title"] == "晨间整理" and item["weekly"] for item in still["blocks"])
    removed = client.delete(f"/api/routines/{block['id']}")
    column = next(day for day in removed.json()["days"] if day["is_today"])
    assert all(item["title"] != "晨间整理" for item in column["blocks"])


def test_token_gates_the_api(tmp_path, monkeypatch):
    monkeypatch.setenv("DAYDESK_DB", str(tmp_path / "locked.db"))
    monkeypatch.setenv("DAYDESK_TOKEN", "secret-token")
    with TestClient(app) as locked:
        assert locked.get("/api/board").status_code == 401
        assert locked.post("/api/login", json={"token": "nope"}).status_code == 401
        assert locked.get("/", follow_redirects=False).status_code == 302
        assert locked.post("/api/login", json={"token": "secret-token"}).status_code == 204
        assert locked.get("/api/board").status_code == 200
