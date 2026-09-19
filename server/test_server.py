import json
import sqlite3

import pytest
from fastapi.testclient import TestClient

from server.app import create_app, digest


@pytest.fixture
def env(tmp_path):
    app = create_app(tmp_path)
    with TestClient(app) as client:
        yield app.state.repo, client


def register(env, name="author", role="user"):
    repo, client = env
    code = repo.invite(role)
    response = client.post("/v1/auth/register", json={"username": name, "password": "test-password-123", "invite": code})
    assert response.status_code == 200, response.text
    return response.json()


def headers(account):
    return {"Authorization": "Bearer " + account["token"]}


def payload(title="First", identifier="book"):
    return json.dumps({"kind": "novel", "novel": {"id": identifier, "title": title}}, ensure_ascii=False)


def push(client, user, text, version=0, key="novel:book"):
    return client.post("/v1/sync/push", headers=headers(user), json={"key": key, "baseVersion": version, "payload": text})


def test_registration_requires_invite_and_no_role_escalation(env):
    repo, client = env
    assert client.post("/v1/auth/register", json={"username": "author", "password": "test-password-123", "invite": "invalid-code"}).status_code == 403
    invite = repo.invite()
    result = client.post("/v1/auth/register", json={"username": "author", "password": "test-password-123", "invite": invite, "role": "admin"})
    assert result.status_code == 200
    assert result.json()["user"]["role"] == "user"
    assert client.post("/v1/auth/register", json={"username": "another", "password": "test-password-123", "invite": invite}).status_code == 403


def test_unauthenticated_access_denied(env):
    _, client = env
    assert client.get("/v1/health").json()["protocol"] == 1
    assert client.get("/v1/sync/manifest").status_code == 401
    assert client.post("/v1/sync/pull", json={"keys": ["novel:book"]}).status_code == 401
    assert client.post("/v1/sync/push", json={}).status_code == 401


def test_account_isolation(env):
    _, client = env
    a, b = register(env, "alice"), register(env, "bobby")
    assert push(client, a, payload("Private Alice")).status_code == 200
    assert client.get("/v1/sync/manifest", headers=headers(b)).json()["records"] == []
    assert client.post("/v1/sync/pull", headers=headers(b), json={"keys": ["novel:book"]}).json()["records"] == []
    assert push(client, b, payload("Private Bob")).status_code == 200
    result = client.post("/v1/sync/pull", headers=headers(a), json={"keys": ["novel:book"]}).json()
    assert "Private Alice" in result["records"][0]["payload"]


def test_compare_and_swap_idempotency_and_offline_conflict(env):
    _, client = env
    a = register(env)
    first = push(client, a, payload()).json()["record"]
    assert first["version"] == 1
    assert first["hash"] == digest(payload())
    assert push(client, a, payload()).json()["record"]["version"] == 1
    assert push(client, a, payload("Home"), 1).status_code == 200
    assert push(client, a, payload("Office"), 1).status_code == 409
    current = client.post("/v1/sync/pull", headers=headers(a), json={"keys": ["novel:book"]}).json()["records"][0]
    assert "Home" in current["payload"]


def test_deletions_have_durable_tombstones(env):
    repo, client = env
    a = register(env)
    push(client, a, payload())
    deleted = push(client, a, None, 1).json()["record"]
    assert deleted["hash"] is None and deleted["version"] == 2
    assert push(client, a, payload("Old offline"), 1).status_code == 409
    with repo.connection() as db:
        assert db.execute("SELECT payload,bytes FROM documents").fetchone()[:] == (None, 0)


def test_bad_payload_does_not_write(env):
    _, client = env
    a = register(env)
    assert push(client, a, '{"kind":"novel","novel":{"id":"different"}}').status_code == 400
    assert push(client, a, "{}").status_code == 400
    assert push(client, a, payload(), True).status_code == 400
    assert push(client, a, payload(), key="config:secrets").status_code == 400
    assert client.get("/v1/sync/manifest", headers=headers(a)).json()["records"] == []


def test_password_recovery_invalidates_all_devices(env):
    _, client = env
    a = register(env)
    second = client.post("/v1/auth/login", json={"username": "author", "password": "test-password-123"}).json()
    result = client.post("/v1/auth/recover", json={"username": "author", "password": "new-password-123", "recoveryCode": a["recoveryCode"]})
    assert result.status_code == 200
    assert result.json()["recoveryCode"] != a["recoveryCode"]
    assert client.get("/v1/auth/me", headers=headers(a)).status_code == 401
    assert client.get("/v1/auth/me", headers=headers(second)).status_code == 401
    assert client.post("/v1/auth/login", json={"username": "author", "password": "test-password-123"}).status_code == 401
    assert client.post("/v1/auth/login", json={"username": "author", "password": "new-password-123"}).status_code == 200


def test_logout_revokes_only_current_device(env):
    _, client = env
    a = register(env)
    b = client.post("/v1/auth/login", json={"username": "author", "password": "test-password-123"}).json()
    assert client.post("/v1/auth/logout", headers=headers(a), json={}).status_code == 200
    assert client.get("/v1/auth/me", headers=headers(a)).status_code == 401
    assert client.get("/v1/auth/me", headers=headers(b)).status_code == 200


def test_server_does_not_store_plaintext_credentials(env):
    repo, _ = env
    a = register(env)
    with repo.connection() as db:
        user = db.execute("SELECT * FROM users").fetchone()
        session = db.execute("SELECT * FROM sessions").fetchone()
        assert user["password_hash"].startswith("$argon2id$")
        assert user["recovery_hash"] == digest(a["recoveryCode"])
        assert session["hash"] == digest(a["token"])


def test_admin_invites_and_storage_quotas(env):
    repo, client = env
    a, b = register(env, "admin", "admin"), register(env, "reader")
    assert client.post("/v1/admin/invites", headers=headers(b), json={}).status_code == 403
    assert client.post("/v1/admin/invites", headers=headers(a), json={"uses": 2}).json()["uses"] == 2
    with repo.connection(True) as db:
        db.execute("UPDATE users SET quota=10 WHERE id=?", (b["user"]["id"],))
    assert push(client, b, payload()).status_code == 413
    assert client.get("/v1/sync/manifest", headers=headers(b)).json()["records"] == []


def test_login_limits_and_spoofed_forwarded_header(env):
    _, client = env
    register(env)
    for index in range(30):
        result = client.post("/v1/auth/login", headers={"X-Real-IP": f"192.0.2.{index}"}, json={"username": "author", "password": "wrong"})
        assert result.status_code == 401
    assert client.post("/v1/auth/login", json={"username": "author", "password": "wrong"}).status_code == 429


def test_invalid_json_and_cors(env):
    _, client = env
    assert client.post("/v1/auth/login", content="{").status_code == 400
    assert client.post("/v1/auth/login", json=[]).status_code == 400
    valid = client.options("/v1/auth/login", headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "POST"})
    assert valid.headers["access-control-allow-origin"] == "http://localhost:5173"
    evil = client.options("/v1/auth/login", headers={"Origin": "https://untrusted.example", "Access-Control-Request-Method": "POST"})
    assert "access-control-allow-origin" not in evil.headers


def test_durable_reopen_and_backup(env, tmp_path):
    from server.app import Repository
    repo, client = env
    user = register(env)
    push(client, user, payload())
    reopened = Repository(repo.directory)
    with reopened.connection() as source, sqlite3.connect(tmp_path / "backup.db") as backup:
        source.backup(backup)
        assert backup.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        assert backup.execute("SELECT COUNT(*) FROM documents").fetchone()[0] == 1


def test_six_character_password_registration_and_recovery(env):
    repo, client = env
    invitation = repo.invite()
    body = {"username": "sixdigits", "password": "12345", "invite": invitation}
    assert client.post("/v1/auth/register", json=body).status_code == 400
    body["password"] = "123456"
    account = client.post("/v1/auth/register", json=body)
    assert account.status_code == 200
    recovery = {"username": body["username"], "recoveryCode": account.json()["recoveryCode"], "password": "65432"}
    assert client.post("/v1/auth/recover", json=recovery).status_code == 400
    recovery["password"] = "654321"
    assert client.post("/v1/auth/recover", json=recovery).status_code == 200
    assert client.post("/v1/auth/login", json={"username": body["username"], "password": "654321"}).status_code == 200


def test_password_change_requires_current_password_and_revokes_all_sessions(env):
    _, client = env
    account = register(env)
    another = client.post("/v1/auth/login", json={"username": "author", "password": "test-password-123"}).json()
    change = lambda old, new: client.post("/v1/auth/password", headers=headers(account),
                                          json={"currentPassword": old, "password": new})
    assert client.post("/v1/auth/password", json={}).status_code == 401
    assert change("wrong-password", "654321").status_code == 403
    assert change("test-password-123", "12345").status_code == 400
    assert change("test-password-123", "test-password-123").status_code == 400
    assert change("test-password-123", "654321").status_code == 200
    for device in (account, another):
        assert client.get("/v1/auth/me", headers=headers(device)).status_code == 401
    assert client.post("/v1/auth/login", json={"username": "author", "password": "test-password-123"}).status_code == 401
    assert client.post("/v1/auth/login", json={"username": "author", "password": "654321"}).status_code == 200
    assert client.post("/v1/auth/recover", json={"username": "author", "password": "newpass",
                       "recoveryCode": account["recoveryCode"]}).status_code == 200


def test_inspiration_sync_is_account_scoped_and_hidden_from_older_clients(env):
    _, client = env
    a, b = register(env, "author_a"), register(env, "author_b")
    text = json.dumps({"kind": "inspiration", "inspiration": {"id": "idea", "messages": [], "draft": "Next idea"}})
    assert push(client, a, text, key="inspiration:idea").status_code == 200
    assert client.get("/v1/sync/manifest", headers=headers(a)).json()["records"] == []
    listing = client.get("/v1/sync/manifest?include=inspiration", headers=headers(a)).json()
    assert "inspiration" in listing["features"]
    assert listing["records"][0]["key"] == "inspiration:idea"
    assert client.post("/v1/sync/pull", headers=headers(b), json={"keys": ["inspiration:idea"]}).json()["records"] == []
