"""HTTP API and the desk pages."""

from __future__ import annotations

import os
import secrets
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from app import store

STATIC = Path(__file__).resolve().parent / "static"
PUBLIC_PATHS = {"/login", "/api/login", "/api/health", "/favicon.ico"}


def _db_path() -> str:
    return os.environ.get("DAYDESK_DB", str(store.ROOT / "data" / "daydesk.db"))


def _token() -> str:
    return os.environ.get("DAYDESK_TOKEN", "")


def _authorized(request: Request) -> bool:
    token = _token()
    if not token:
        return True
    cookie = request.cookies.get("daydesk_session", "")
    if len(cookie) != len(token):
        return False
    return secrets.compare_digest(cookie, token)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    store.configure(_db_path())
    yield
    store.close()


app = FastAPI(title="Daydesk", lifespan=lifespan)
app.mount("/static", StaticFiles(directory=STATIC), name="static")


@app.middleware("http")
async def require_token(request: Request, call_next):
    path = request.url.path
    if path in PUBLIC_PATHS or path.startswith("/static/"):
        return await call_next(request)
    if _authorized(request):
        return await call_next(request)
    if path.startswith("/api/"):
        return JSONResponse({"detail": "需要口令"}, status_code=401)
    return RedirectResponse("/login", status_code=302)


class TodoIn(BaseModel):
    title: str
    due_date: str | None = None
    goal_id: int | None = None
    priority: str = "normal"
    waiting: bool = False


class SparkIn(BaseModel):
    text: str


class FlowIn(BaseModel):
    action: str
    title: str = ""
    origin: str = ""
    outline: str = ""
    body: str = ""
    hypothesis: str = ""
    smallest_step: str = ""


class SparkPatch(BaseModel):
    title: str | None = None
    origin: str | None = None
    outline: str | None = None
    body: str | None = None
    result: str | None = None
    settle: bool = False


class BlockIn(BaseModel):
    day: str
    start: str
    end: str
    title: str
    todo_id: int | None = None
    repeat: bool = False


class DispositionIn(BaseModel):
    todo_id: int
    action: str
    date: str | None = None


class DailyIn(BaseModel):
    blocker: str = ""
    next: list[str] = Field(default_factory=list)
    items: list[DispositionIn] = Field(default_factory=list)


class WeeklyIn(BaseModel):
    goals: list[str] = Field(default_factory=list)


class GoalsIn(BaseModel):
    goals: list[str] = Field(default_factory=list)


class ProfileIn(BaseModel):
    title: str
    note: str = ""
    theme: str = "paper"


class LoginIn(BaseModel):
    token: str


def _call(fn, *args):
    try:
        return fn(*args)
    except store.DeskError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/health")
def health():
    store.board()
    return {"ok": True}


@app.get("/api/board")
def get_board():
    return store.board()


@app.post("/api/todos")
def post_todo(body: TodoIn):
    return _call(store.create_todo, body.title, body.due_date, body.goal_id, body.priority, body.waiting)


@app.post("/api/todos/{todo_id}/done")
def post_done(todo_id: int):
    return _call(store.finish_todo, todo_id)


@app.post("/api/todos/{todo_id}/postpone")
def post_postpone(todo_id: int):
    return _call(store.postpone_todo, todo_id)


@app.post("/api/todos/{todo_id}/drop")
def post_drop(todo_id: int):
    return _call(store.drop_todo, todo_id)


@app.post("/api/sparks")
def post_spark(body: SparkIn):
    return _call(store.add_spark, body.text)


@app.delete("/api/sparks/{spark_id}")
def remove_spark(spark_id: int):
    return _call(store.delete_spark, spark_id)


@app.post("/api/sparks/{spark_id}/flow")
def post_flow(spark_id: int, body: FlowIn):
    return _call(store.flow_spark, spark_id, body.action, body.model_dump())


@app.patch("/api/sparks/{spark_id}")
def patch_spark(spark_id: int, body: SparkPatch):
    return _call(store.update_spark, spark_id, body.model_dump())


@app.post("/api/blocks")
def post_block(body: BlockIn):
    return _call(store.add_block, body.day, body.start, body.end, body.title, body.todo_id, body.repeat)


@app.delete("/api/blocks/{block_id}")
def remove_block(block_id: int):
    return _call(store.delete_block, block_id)


@app.delete("/api/routines/{routine_id}")
def remove_routine(routine_id: int):
    return _call(store.delete_routine, routine_id)


@app.post("/api/reviews/daily")
def post_daily(body: DailyIn):
    return _call(store.save_daily, body.blocker, body.next, [item.model_dump() for item in body.items])


@app.post("/api/reviews/weekly")
def post_weekly(body: WeeklyIn):
    return _call(store.save_next_goals, body.goals)


@app.put("/api/goals")
def put_goals(body: GoalsIn):
    return _call(store.save_current_goals, body.goals)


@app.put("/api/profile")
def put_profile(body: ProfileIn):
    return _call(store.save_profile, body.title, body.note, body.theme)


@app.post("/api/login", status_code=204)
def login(body: LoginIn, request: Request):
    token = _token()
    given = body.token or ""
    if not token or len(given) != len(token) or not secrets.compare_digest(given, token):
        raise HTTPException(status_code=401, detail="口令不对")
    response = Response(status_code=204)
    secure = request.headers.get("x-forwarded-proto", request.url.scheme) == "https"
    response.set_cookie(
        "daydesk_session",
        token,
        max_age=60 * 60 * 24 * 30,
        httponly=True,
        samesite="lax",
        secure=secure,
        path="/",
    )
    return response


@app.get("/")
def index():
    return FileResponse(STATIC / "index.html")


@app.get("/login")
def login_page(request: Request):
    if _authorized(request):
        return RedirectResponse("/", status_code=302)
    return FileResponse(STATIC / "login.html")


@app.get("/favicon.ico")
def favicon():
    return Response(status_code=204)
