"""Account-isolated settings and opaque client-encrypted credential envelopes."""
import base64
import binascii
import hmac
import json
import math
import os
import re
import secrets
import tempfile
import time
from pathlib import Path
from urllib.parse import urlsplit

from fastapi import Request
from fastapi.responses import JSONResponse


def exact(value, fields):
    return isinstance(value, dict) and set(value) == set(fields.split())


def text(value, maximum, minimum=0):
    return isinstance(value, str) and minimum <= len(value) <= maximum


def identifier(value):
    return (text(value, 200, 1) and not re.search(r"[\x00-\x1f\x7f]", value)
            and value not in ("__proto__", "constructor", "prototype"))


def number(value, minimum, maximum):
    return type(value) in (int, float) and math.isfinite(value) and minimum <= value <= maximum


def api_url(value):
    if not text(value, 2000, 1):
        return False
    try:
        p = urlsplit(value)
        return p.scheme in ("https", "http") and bool(p.hostname) and not (p.username or p.password or p.query or p.fragment)
    except ValueError:
        return False


def encoded(value, minimum, maximum):
    if not text(value, 174784):
        return False
    try:
        decoded = base64.b64decode(value, validate=True)
        return minimum <= len(decoded) <= maximum and base64.b64encode(decoded).decode() == value
    except (ValueError, binascii.Error):
        return False


def valid_envelope(value):
    return (exact(value, "schema kdf iterations salt iv ciphertext")
            and type(value["schema"]) is int and value["schema"] == 1
            and value["kdf"] == "PBKDF2-SHA256"
            and type(value["iterations"]) is int and value["iterations"] == 600000
            and encoded(value["salt"], 16, 16) and encoded(value["iv"], 12, 12)
            and encoded(value["ciphertext"], 16, 131088))


def valid_settings(s):
    if not exact(s, "schema models assignments embedding skills aiWorkflowMode pdfVisionEnabled theme"):
        return False
    if type(s["schema"]) is not int or s["schema"] != 1 or not isinstance(s["models"], list) or len(s["models"]) > 200:
        return False
    ids = set()
    chat_ids, embedding_ids = set(), set()
    required = set("id name baseUrl modelName maxTokens temperature topP".split())
    for m in s["models"]:
        if not isinstance(m, dict) or not required <= set(m) or not set(m) <= required | {"contextWindow", "chatSearchProtocol", "kind"}:
            return False
        if not identifier(m["id"]) or m["id"] in ids or not text(m["name"], 200) or not api_url(m["baseUrl"]) or not text(m["modelName"], 200, 1):
            return False
        ids.add(m["id"])
        kind = m.get("kind", "chat")
        if kind not in ("chat", "embedding"):
            return False
        (embedding_ids if kind == "embedding" else chat_ids).add(m["id"])
        if not number(m["maxTokens"], 1, 2000000) or not number(m["temperature"], 0, 2) or not number(m["topP"], 0, 1):
            return False
        if "contextWindow" in m and not number(m["contextWindow"], 1, 10000000):
            return False
        if "chatSearchProtocol" in m and m["chatSearchProtocol"] not in ("auto", "responses", "anthropic", "openrouter", "chat-completions"):
            return False
    a = s["assignments"]
    tasks = {"outline", "writing", "review", "chat"}
    if not isinstance(a, dict) or not tasks <= set(a) or not set(a) <= tasks | {"embedding"}:
        return False
    if any(not isinstance(a[task], str) or (a[task] and a[task] not in chat_ids) for task in tasks):
        return False
    if "embedding" in a and (not isinstance(a["embedding"], str) or (a["embedding"] and a["embedding"] not in embedding_ids)):
        return False
    e = s["embedding"]
    if not exact(e, "enabled baseUrl modelName batchSize") or type(e["enabled"]) is not bool or not api_url(e["baseUrl"]) or not text(e["modelName"], 200) or not number(e["batchSize"], 1, 2048):
        return False
    if not isinstance(s["skills"], list) or len(s["skills"]) > 100:
        return False
    skill_ids = set()
    for skill in s["skills"]:
        if not exact(skill, "id name description task instructions enabled builtIn createdAt updatedAt"):
            return False
        if not identifier(skill["id"]) or skill["id"] in skill_ids:
            return False
        skill_ids.add(skill["id"])
        for field, maximum in (("name", 200), ("description", 2000), ("instructions", 16000), ("createdAt", 64), ("updatedAt", 64)):
            if not text(skill[field], maximum):
                return False
        if skill["task"] not in ("planning", "writing", "review", "analysis", "all") or type(skill["enabled"]) is not bool or type(skill["builtIn"]) is not bool:
            return False
    return s["aiWorkflowMode"] in ("fast", "balanced", "strict") and type(s["pdfVisionEnabled"]) is bool and s["theme"] in ("fanqie", "eyecare", "dark")


def valid_bundle(payload):
    try:
        bundle = json.loads(payload)
        return (exact(bundle, "schema settings vault") and type(bundle["schema"]) is int and bundle["schema"] in (1, 2)
                and valid_settings(bundle["settings"]) and valid_envelope(bundle["vault"]))
    except (ValueError, RecursionError, TypeError):
        return False


def preference_record(row):
    return {"version": row["version"], "hash": row["hash"], "updatedAt": int(row["updated"] * 1000), "payload": row["payload"]}


def master_verifier(master):
    return hmac.digest(master, b"mojian-preferences-master-check:v1", "sha256").hex()


def managed_preferences_exist(db):
    for row in db.execute("SELECT payload FROM account_preferences"):
        if json.loads(row[0]).get("schema") == 2:
            return True
    return False


def read_master_key(directory, db):
    """Read and validate against this database (also used for backup snapshots)."""
    marker = db.execute("SELECT value FROM server_settings WHERE key='preferences_master_verifier'").fetchone()
    path = Path(directory) / "preferences-master.key"
    try:
        if path.is_symlink():
            raise RuntimeError("Preferences master key must be a regular file")
        master = path.read_bytes() if path.exists() else None
    except OSError as cause:
        raise RuntimeError("Preferences master key is unavailable") from cause
    if master is not None and len(master) != 32:
        raise RuntimeError("Preferences master key has invalid length")
    if marker:
        if master is None or not hmac.compare_digest(marker[0], master_verifier(master)):
            raise RuntimeError("Preferences master key does not match the database")
    elif managed_preferences_exist(db):
        raise RuntimeError("Preferences key verification metadata is missing")
    return master


def ensure_master_key(repo):
    # SQLite serializes initialization across threads/processes. An interrupted
    # creation never publishes a partial key or replaces an existing key.
    with repo.connection(True) as db:
        master = read_master_key(repo.directory, db)
        if master is None:
            path = repo.directory / "preferences-master.key"
            fd, temporary = tempfile.mkstemp(prefix=".preferences-master-", dir=repo.directory)
            temporary = Path(temporary)
            try:
                with os.fdopen(fd, "wb") as target:
                    target.write(secrets.token_bytes(32))
                    target.flush()
                    os.fsync(target.fileno())
                try:
                    os.link(temporary, path)
                except FileExistsError:
                    pass
                if os.name != "nt":
                    directory_fd = os.open(repo.directory, os.O_RDONLY | os.O_DIRECTORY)
                    try:
                        os.fsync(directory_fd)
                    finally:
                        os.close(directory_fd)
                master = read_master_key(repo.directory, db)
                if master is None:
                    raise RuntimeError("Preferences master key was not created")
            finally:
                temporary.unlink(missing_ok=True)
        db.execute("INSERT INTO server_settings(key,value) VALUES('preferences_master_verifier',?) "
                   "ON CONFLICT(key) DO NOTHING", (master_verifier(master),))
        return master


def account_key(repo, user_id):
    master = ensure_master_key(repo)
    return base64.b64encode(hmac.digest(master, b"mojian-preferences-user-key:v1:" + user_id.encode("utf-8"), "sha256")).decode()


def mount_preferences(app, repo, body_json, fail, digest):
    @app.get("/v1/sync/preferences/key")
    def get_preferences_key(request: Request):
        user, _ = repo.authenticate(request)
        repo.rate("preferences-key:" + user["id"], 600, 3600)
        try:
            key = account_key(repo, user["id"])
        except (RuntimeError, OSError):
            fail(503, "Preferences key unavailable; restore the matching server key backup")
        return JSONResponse({"schema": 1, "key": key}, headers={"Cache-Control": "no-store"})

    @app.get("/v1/sync/preferences")
    def get_preferences(request: Request):
        user, _ = repo.authenticate(request)
        with repo.connection() as db:
            row = db.execute("SELECT * FROM account_preferences WHERE user_id=?", (user["id"],)).fetchone()
        return {"record": preference_record(row) if row else None}

    @app.post("/v1/sync/preferences")
    async def save_preferences(request: Request):
        user, _ = repo.authenticate(request)
        repo.rate("preferences:" + user["id"], 120, 3600)
        body = await body_json(request)
        version, payload = body.get("baseVersion"), body.get("payload")
        if not exact(body, "baseVersion payload") or type(version) is not int or version < 0 or not isinstance(payload, str):
            fail(400, "Invalid preferences")
        try:
            size = len(payload.encode("utf-8"))
        except UnicodeError:
            fail(400, "Invalid preferences")
        if size > 512 * 1024:
            fail(413, "Preferences exceed 512 KiB")
        if not valid_bundle(payload):
            fail(400, "Invalid preferences")
        if json.loads(payload)["schema"] == 2:
            try:
                ensure_master_key(repo)
            except (RuntimeError, OSError):
                fail(503, "Preferences key unavailable; restore the matching server key backup")
        hashed = digest(payload)
        with repo.connection(True) as db:
            current = db.execute("SELECT * FROM account_preferences WHERE user_id=?", (user["id"],)).fetchone()
            if current and current["hash"] == hashed:
                return {"record": preference_record(current)}
            if (current["version"] if current else 0) != version:
                fail(409, "Preferences changed on another device")
            docs = db.execute("SELECT COALESCE(SUM(bytes),0) FROM documents WHERE user_id=?", (user["id"],)).fetchone()[0]
            if docs + size > user["quota"]:
                fail(413, "Account storage quota exceeded")
            all_docs = db.execute("SELECT COALESCE(SUM(bytes),0) FROM documents").fetchone()[0]
            all_prefs = db.execute("SELECT COALESCE(SUM(bytes),0) FROM account_preferences").fetchone()[0]
            if all_docs + all_prefs - (current["bytes"] if current else 0) + size > int(os.environ.get("SYNC_GLOBAL_QUOTA", str(12 * 1024**3))):
                fail(507, "Server storage quota reached")
            db.execute("""INSERT INTO account_preferences VALUES(?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET
                       version=excluded.version,payload=excluded.payload,hash=excluded.hash,bytes=excluded.bytes,updated=excluded.updated""",
                       (user["id"], version + 1, payload, hashed, size, time.time()))
            row = db.execute("SELECT * FROM account_preferences WHERE user_id=?", (user["id"],)).fetchone()
            return {"record": preference_record(row)}
