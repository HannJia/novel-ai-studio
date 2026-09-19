"""Account-isolated, optimistic-concurrency sync. Never stores model credentials."""
import hashlib
import ipaddress
import json
import os
import re
import secrets
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path

from argon2 import PasswordHasher
from argon2.exceptions import VerificationError
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware

VERSION = "1.0.5"
MAX_BODY = 64 * 1024 * 1024
MAX_DOCUMENT = 50 * 1024 * 1024
DEFAULT_QUOTA = 100 * 1024 * 1024
SESSION_SECONDS = 30 * 86400
MIN_PASSWORD_LENGTH = 6
PASSWORDS = PasswordHasher(time_cost=2, memory_cost=32768, parallelism=1)
DUMMY_PASSWORD = PASSWORDS.hash(secrets.token_urlsafe(32))


def digest(value):
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def fail(status, detail):
    raise HTTPException(status_code=status, detail=detail)


def checked_text(body, name, minimum=1, maximum=200):
    value = body.get(name)
    if not isinstance(value, str) or not minimum <= len(value) <= maximum:
        fail(400, f"Invalid {name}")
    return value


class Repository:
    def __init__(self, directory):
        self.directory = Path(directory)
        self.directory.mkdir(parents=True, exist_ok=True)
        self.path = self.directory / "sync.sqlite3"
        with self.connection() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS users(
                  id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL,
                  password_hash TEXT NOT NULL, recovery_hash TEXT NOT NULL,
                  role TEXT NOT NULL, quota INTEGER NOT NULL, created REAL NOT NULL);
                CREATE TABLE IF NOT EXISTS sessions(
                  hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires REAL NOT NULL);
                CREATE INDEX IF NOT EXISTS session_user ON sessions(user_id);
                CREATE TABLE IF NOT EXISTS invites(
                  hash TEXT PRIMARY KEY, role TEXT NOT NULL, remaining INTEGER NOT NULL,
                  expires REAL NOT NULL, created_by TEXT, created REAL NOT NULL);
                CREATE TABLE IF NOT EXISTS documents(
                  user_id TEXT NOT NULL, key TEXT NOT NULL, version INTEGER NOT NULL,
                  payload TEXT, hash TEXT, bytes INTEGER NOT NULL, updated REAL NOT NULL,
                  PRIMARY KEY(user_id,key));
                CREATE TABLE IF NOT EXISTS limits(
                  key TEXT PRIMARY KEY, attempts INTEGER NOT NULL, expires REAL NOT NULL);
            """)

    @contextmanager
    def connection(self, transaction=False):
        db = sqlite3.connect(self.path, timeout=20, isolation_level=None)
        db.row_factory = sqlite3.Row
        try:
            db.execute("PRAGMA busy_timeout=20000")
            db.execute("PRAGMA journal_mode=WAL")
            db.execute("PRAGMA synchronous=FULL")
            if transaction:
                db.execute("BEGIN IMMEDIATE")
            yield db
            if transaction:
                db.execute("COMMIT")
        except BaseException:
            if transaction and db.in_transaction:
                db.execute("ROLLBACK")
            raise
        finally:
            db.close()

    def rate(self, key, count, seconds):
        now = time.time()
        with self.connection(True) as db:
            db.execute("DELETE FROM limits WHERE expires < ?", (now,))
            row = db.execute("SELECT * FROM limits WHERE key=?", (key,)).fetchone()
            if row and row["attempts"] >= count:
                fail(429, "Too many requests; try later")
            db.execute("""INSERT INTO limits VALUES(?,1,?) ON CONFLICT(key)
                       DO UPDATE SET attempts=attempts+1""", (key, now + seconds))

    def invite(self, role="user", uses=1, days=7, creator=None):
        code = secrets.token_urlsafe(24)
        with self.connection(True) as db:
            db.execute("INSERT INTO invites VALUES(?,?,?,?,?,?)",
                       (digest(code), role, uses, time.time() + days * 86400, creator, time.time()))
        return code

    def session(self, db, user):
        now = time.time()
        db.execute("DELETE FROM sessions WHERE expires < ?", (now,))
        # Keep the most recent eight device sessions.
        older = db.execute("SELECT hash FROM sessions WHERE user_id=? ORDER BY expires DESC LIMIT -1 OFFSET 7",
                           (user["id"],)).fetchall()
        for row in older:
            db.execute("DELETE FROM sessions WHERE hash=?", (row["hash"],))
        token = secrets.token_urlsafe(40)
        db.execute("INSERT INTO sessions VALUES(?,?,?)", (digest(token), user["id"], now + SESSION_SECONDS))
        return {"token": token, "expiresAt": int((now + SESSION_SECONDS) * 1000),
                "user": self.public_user(db, user)}

    @staticmethod
    def public_user(db, user):
        used = db.execute("SELECT COALESCE(SUM(bytes),0) FROM documents WHERE user_id=?", (user["id"],)).fetchone()[0]
        return {"id": user["id"], "username": user["username"], "role": user["role"],
                "quotaBytes": user["quota"], "usedBytes": used}

    def authenticate(self, request):
        header = request.headers.get("authorization", "")
        if not header.startswith("Bearer ") or len(header) > 200:
            fail(401, "Sign in required")
        token_hash = digest(header[7:])
        with self.connection() as db:
            user = db.execute("""SELECT users.* FROM sessions JOIN users ON users.id=sessions.user_id
                               WHERE sessions.hash=? AND sessions.expires>?""", (token_hash, time.time())).fetchone()
            if not user:
                fail(401, "Session expired")
            return dict(user), token_hash


async def body_json(request):
    if request.headers.get("content-encoding", "identity") != "identity":
        fail(415, "Compressed requests are not supported")
    data = bytearray()
    async for chunk in request.stream():
        data.extend(chunk)
        if len(data) > MAX_BODY:
            fail(413, "Request too large")
    try:
        body = json.loads(data)
    except (ValueError, RecursionError):
        fail(400, "Invalid JSON")
    if not isinstance(body, dict):
        fail(400, "Expected JSON object")
    return body


def remote_ip(request):
    host = request.client.host if request.client else "unknown"
    if host in ("127.0.0.1", "::1"):
        forwarded = request.headers.get("x-real-ip", "")
        try:
            return str(ipaddress.ip_address(forwarded))
        except ValueError:
            pass
    return host


def checked_key(key):
    if not isinstance(key, str) or not re.fullmatch(r"(novel|knowledge|inspiration):[^\x00-\x1f\x7f]{1,200}", key):
        fail(400, "Invalid document key")
    return key


def record(row, payload=True):
    result = {"key": row["key"], "version": row["version"], "hash": row["hash"],
              "bytes": row["bytes"], "updatedAt": int(row["updated"] * 1000)}
    if payload:
        result["payload"] = row["payload"]
    return result


def create_app(data_dir=None):
    repo = Repository(data_dir or os.environ.get("SYNC_DATA_DIR", "/var/lib/novel-sync"))
    app = FastAPI(title="Novel Writer Sync", version=VERSION, docs_url=None, redoc_url=None, openapi_url=None)
    app.state.repo = repo
    app.add_middleware(CORSMiddleware, allow_origins=["null", "http://localhost:5173", "http://127.0.0.1:5173"],
                       allow_methods=["GET", "POST"], allow_headers=["Authorization", "Content-Type"])

    @app.middleware("http")
    async def security_headers(request, call_next):
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        return response

    @app.get("/v1/health")
    def health():
        return {"ok": True, "version": VERSION, "protocol": 1, "features": ["inspiration", "change-password"]}

    @app.post("/v1/auth/register")
    async def register(request: Request):
        repo.rate("register:" + remote_ip(request), 10, 3600)
        body = await body_json(request)
        username = checked_text(body, "username", 3, 32).lower()
        if not re.fullmatch(r"[a-z0-9][a-z0-9_-]{2,31}", username):
            fail(400, "Username must use 3-32 letters, numbers, underscores or hyphens")
        password = checked_text(body, "password", MIN_PASSWORD_LENGTH, 256)
        invitation = checked_text(body, "invite", 10, 100)
        with repo.connection() as db:
            invite = db.execute("SELECT * FROM invites WHERE hash=? AND remaining>0 AND expires>?",
                                (digest(invitation), time.time())).fetchone()
        if not invite:
            fail(403, "Invalid or expired invitation")
        hashed = PASSWORDS.hash(password)
        recovery = secrets.token_urlsafe(32)
        with repo.connection(True) as db:
            if db.execute("SELECT COUNT(*) FROM users").fetchone()[0] >= int(os.environ.get("SYNC_MAX_USERS", "300")):
                fail(503, "Registration capacity reached")
            invite = db.execute("SELECT * FROM invites WHERE hash=? AND remaining>0 AND expires>?",
                                (digest(invitation), time.time())).fetchone()
            if not invite:
                fail(403, "Invalid or expired invitation")
            if db.execute("SELECT 1 FROM users WHERE username=?", (username,)).fetchone():
                fail(409, "Username already exists")
            uid = secrets.token_hex(16)
            db.execute("INSERT INTO users VALUES(?,?,?,?,?,?,?)",
                       (uid, username, hashed, digest(recovery), invite["role"], DEFAULT_QUOTA, time.time()))
            db.execute("UPDATE invites SET remaining=remaining-1 WHERE hash=?", (digest(invitation),))
            user = db.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
            return {**repo.session(db, user), "recoveryCode": recovery}

    @app.post("/v1/auth/login")
    async def login(request: Request):
        repo.rate("login-ip:" + remote_ip(request), 30, 900)
        body = await body_json(request)
        username = checked_text(body, "username", 3, 32).lower()
        password = checked_text(body, "password", 1, 256)
        repo.rate("login-user:" + digest(username), 30, 900)
        with repo.connection() as db:
            user = db.execute("SELECT * FROM users WHERE username=?", (username,)).fetchone()
        try:
            PASSWORDS.verify(user["password_hash"] if user else DUMMY_PASSWORD, password)
        except VerificationError:
            fail(401, "Incorrect username or password")
        if not user:
            fail(401, "Incorrect username or password")
        with repo.connection(True) as db:
            # A simultaneous reset must invalidate an in-flight login.
            current = db.execute("SELECT * FROM users WHERE id=?", (user["id"],)).fetchone()
            if not current or current["password_hash"] != user["password_hash"]:
                fail(401, "Please sign in again")
            return repo.session(db, current)

    @app.post("/v1/auth/logout")
    def logout(request: Request):
        _, token_hash = repo.authenticate(request)
        with repo.connection(True) as db:
            db.execute("DELETE FROM sessions WHERE hash=?", (token_hash,))
        return {"ok": True}

    @app.get("/v1/auth/me")
    def me(request: Request):
        user, _ = repo.authenticate(request)
        with repo.connection() as db:
            return repo.public_user(db, user)

    @app.post("/v1/auth/recover")
    async def recover(request: Request):
        repo.rate("recover:" + remote_ip(request), 5, 3600)
        body = await body_json(request)
        username = checked_text(body, "username", 3, 32).lower()
        code = checked_text(body, "recoveryCode", 10, 100)
        password = checked_text(body, "password", MIN_PASSWORD_LENGTH, 256)
        hashed = PASSWORDS.hash(password)
        next_code = secrets.token_urlsafe(32)
        with repo.connection(True) as db:
            user = db.execute("SELECT * FROM users WHERE username=?", (username,)).fetchone()
            if not user or not secrets.compare_digest(user["recovery_hash"], digest(code)):
                fail(403, "Invalid recovery details")
            db.execute("UPDATE users SET password_hash=?,recovery_hash=? WHERE id=?",
                       (hashed, digest(next_code), user["id"]))
            db.execute("DELETE FROM sessions WHERE user_id=?", (user["id"],))
        return {"ok": True, "recoveryCode": next_code}

    @app.post("/v1/admin/invites")
    async def invitations(request: Request):
        user, _ = repo.authenticate(request)
        if user["role"] != "admin":
            fail(403, "Administrator required")
        repo.rate("invite:" + user["id"], 30, 3600)
        body = await body_json(request)
        uses = body.get("uses", 1)
        if type(uses) is not int or not 1 <= uses <= 20:
            fail(400, "Invalid invitation uses")
        return {"code": repo.invite(uses=uses, creator=user["id"]), "uses": uses, "expiresInDays": 7}

    @app.post("/v1/auth/password")
    async def change_password(request: Request):
        user, token_hash = repo.authenticate(request)
        repo.rate("password:" + user["id"], 10, 900)
        body = await body_json(request)
        current_password = checked_text(body, "currentPassword", 1, 256)
        new_password = checked_text(body, "password", MIN_PASSWORD_LENGTH, 256)
        try:
            PASSWORDS.verify(user["password_hash"], current_password)
        except VerificationError:
            fail(403, "Current password is incorrect")
        if new_password == current_password:
            fail(400, "New password must be different")
        hashed = PASSWORDS.hash(new_password)
        with repo.connection(True) as db:
            current = db.execute("SELECT password_hash FROM users WHERE id=?", (user["id"],)).fetchone()
            valid_session = db.execute("SELECT 1 FROM sessions WHERE hash=? AND expires>?",
                                       (token_hash, time.time())).fetchone()
            if not current or current["password_hash"] != user["password_hash"] or not valid_session:
                fail(401, "Please sign in again")
            db.execute("UPDATE users SET password_hash=? WHERE id=?", (hashed, user["id"]))
            db.execute("DELETE FROM sessions WHERE user_id=?", (user["id"],))
        return {"ok": True}

    @app.get("/v1/sync/manifest")
    def manifest(request: Request):
        user, _ = repo.authenticate(request)
        with repo.connection() as db:
            rows = db.execute("SELECT key,version,hash,bytes,updated FROM documents WHERE user_id=? ORDER BY key",
                              (user["id"],)).fetchall()
        include_inspiration = request.query_params.get("include") == "inspiration"
        return {"protocol": 1, "features": ["inspiration", "change-password"],
                "records": [record(row, False) for row in rows if include_inspiration or not row["key"].startswith("inspiration:")]}

    @app.post("/v1/sync/pull")
    async def pull(request: Request):
        user, _ = repo.authenticate(request)
        body = await body_json(request)
        keys = body.get("keys")
        if not isinstance(keys, list) or not 1 <= len(keys) <= 20:
            fail(400, "Request 1-20 document keys")
        results, total = [], 0
        with repo.connection() as db:
            for key in dict.fromkeys(checked_key(key) for key in keys):
                row = db.execute("SELECT * FROM documents WHERE user_id=? AND key=?", (user["id"], key)).fetchone()
                if row:
                    total += row["bytes"]
                    if total > MAX_BODY:
                        fail(413, "Pull fewer documents per request")
                    results.append(record(row))
        return {"records": results}

    @app.post("/v1/sync/push")
    async def push(request: Request):
        user, _ = repo.authenticate(request)
        repo.rate("push:" + user["id"], 600, 3600)
        body = await body_json(request)
        key = checked_key(body.get("key"))
        version = body.get("baseVersion")
        payload = body.get("payload")
        if type(version) is not int or version < 0:
            fail(400, "Invalid base version")
        if payload is not None and not isinstance(payload, str):
            fail(400, "Invalid document payload")
        try:
            size = len(payload.encode("utf-8")) if payload is not None else 0
        except UnicodeError:
            fail(400, "Invalid Unicode")
        if size > MAX_DOCUMENT:
            fail(413, "Document exceeds 50 MiB")
        if payload is not None:
            try:
                parsed = json.loads(payload)
                kind, identifier = key.split(":", 1)
                if not isinstance(parsed, dict) or parsed.get("kind") != kind:
                    fail(400, "Document kind mismatch")
                entity = parsed.get(kind)
                if not isinstance(entity, dict) or entity.get("id") != identifier:
                    fail(400, "Document ID mismatch")
            except (ValueError, RecursionError):
                fail(400, "Invalid document JSON")
        hashed = digest(payload) if payload is not None else None
        now = time.time()
        with repo.connection(True) as db:
            current = db.execute("SELECT * FROM documents WHERE user_id=? AND key=?", (user["id"], key)).fetchone()
            if current and current["hash"] == hashed:
                return {"record": record(current)}
            if (current["version"] if current else 0) != version:
                # A client may have missed an acknowledgement. Never overwrite a concurrent writer.
                fail(409, "Document changed on another device")
            count = db.execute("SELECT COUNT(*) FROM documents WHERE user_id=?", (user["id"],)).fetchone()[0]
            if not current and count >= 2000:
                fail(413, "Document count quota exceeded")
            used = db.execute("SELECT COALESCE(SUM(bytes),0) FROM documents WHERE user_id=?", (user["id"],)).fetchone()[0]
            delta = size - (current["bytes"] if current else 0)
            if used + delta > user["quota"]:
                fail(413, "Account storage quota exceeded")
            total = db.execute("SELECT COALESCE(SUM(bytes),0) FROM documents").fetchone()[0]
            if total + delta > int(os.environ.get("SYNC_GLOBAL_QUOTA", str(12 * 1024**3))):
                fail(507, "Server storage quota reached")
            next_version = version + 1
            db.execute("""INSERT INTO documents VALUES(?,?,?,?,?,?,?)
                        ON CONFLICT(user_id,key) DO UPDATE SET
                        version=excluded.version,payload=excluded.payload,hash=excluded.hash,
                        bytes=excluded.bytes,updated=excluded.updated""",
                       (user["id"], key, next_version, payload, hashed, size, now))
            row = db.execute("SELECT * FROM documents WHERE user_id=? AND key=?", (user["id"], key)).fetchone()
            return {"record": record(row)}

    return app
