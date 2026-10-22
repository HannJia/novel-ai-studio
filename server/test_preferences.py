import base64
import copy
import json

import pytest
from fastapi.testclient import TestClient

from server.app import create_app
from server.test_server import env, register, headers, payload, push


def bundle():
    return {"schema": 1, "settings": {"schema": 1, "models": [{"id": "model", "name": "Test", "baseUrl": "https://api.example.test/v1", "modelName": "test-model", "maxTokens": 4096, "temperature": 0.7, "topP": 1}],
            "assignments": {"outline": "model", "writing": "model", "review": "model", "chat": ""},
            "embedding": {"enabled": False, "baseUrl": "http://127.0.0.1:11434", "modelName": "bge-m3", "batchSize": 16},
            "skills": [], "aiWorkflowMode": "balanced", "pdfVisionEnabled": False, "theme": "fanqie"},
            "vault": {"schema": 1, "kdf": "PBKDF2-SHA256", "iterations": 600000, "salt": base64.b64encode(b"0" * 16).decode(),
                      "iv": base64.b64encode(b"1" * 12).decode(), "ciphertext": base64.b64encode(b"opaque-test-ciphertext").decode()}}


def save(client, account, data=None, version=0):
    return client.post("/v1/sync/preferences", headers=headers(account), json={"baseVersion": version, "payload": json.dumps(data or bundle())})


@pytest.mark.parametrize("schema", [1, 2])
def test_model_capabilities_and_embedding_assignment_round_trip(env, schema):
    _, client = env
    account = register(env)
    data = bundle()
    data["schema"] = schema
    vector = copy.deepcopy(data["settings"]["models"][0])
    vector.update(id="vector", kind="embedding", modelName="test-vector")
    data["settings"]["models"].append(vector)
    data["settings"]["assignments"]["embedding"] = "vector"
    assert save(client, account, data).status_code == 200
    remote = client.get("/v1/sync/preferences", headers=headers(account)).json()["record"]
    assert json.loads(remote["payload"]) == data
    # Original clients retain the legacy shape and may still update the record.
    assert save(client, account, bundle(), 1).status_code == 200


@pytest.mark.parametrize("mutation", ["kind", "null-kind", "chat-to-vector", "vector-to-chat", "unknown", "null-assignment", "extra-task", "plaintext-vector"])
def test_wrong_capabilities_do_not_replace_saved_preferences(env, mutation):
    _, client = env
    account = register(env)
    assert save(client, account).status_code == 200
    data = bundle()
    model = data["settings"]["models"][0]
    assignment = data["settings"]["assignments"]
    if mutation == "kind": model["kind"] = "image"
    elif mutation == "null-kind": model["kind"] = None
    elif mutation == "chat-to-vector": model["kind"] = "embedding"
    elif mutation == "vector-to-chat": assignment["embedding"] = "model"
    elif mutation == "unknown": assignment["embedding"] = "missing"
    elif mutation == "null-assignment": assignment["embedding"] = None
    elif mutation == "extra-task": assignment["image"] = "model"
    else:
        vector = copy.deepcopy(model)
        vector.update(id="vector", kind="embedding", apiKey="synthetic-plaintext")
        data["settings"]["models"].append(vector)
    assert save(client, account, data, 1).status_code == 400
    record = client.get("/v1/sync/preferences", headers=headers(account)).json()["record"]
    assert record["version"] == 1


def test_upgrade_preserves_old_database_accounts_sessions_and_documents(env):
    repo, client = env
    account = register(env)
    assert push(client, account, payload("Legacy work")).status_code == 200
    tables = ("users", "sessions", "invites", "documents", "limits")
    with repo.connection() as db:
        db.execute("DROP TABLE account_preferences")
        before = {table: [tuple(row) for row in db.execute(f"SELECT * FROM {table} ORDER BY rowid")] for table in tables}
    upgraded = create_app(repo.directory)
    with upgraded.state.repo.connection() as db:
        after = {table: [tuple(row) for row in db.execute(f"SELECT * FROM {table} ORDER BY rowid")] for table in tables}
    assert after == before
    with TestClient(upgraded) as restored:
        health = restored.get("/v1/health").json()
        assert health["version"] == "1.0.7" and health["protocol"] == 1
        assert "preferences-v1" in health["features"]
        assert restored.get("/v1/sync/preferences", headers=headers(account)).json() == {"record": None}
        assert save(restored, account).status_code == 200
        records = restored.get("/v1/sync/manifest", headers=headers(account)).json()["records"]
        assert len(records) == 1 and records[0]["key"] == "novel:book" and records[0]["version"] == 1
        assert push(restored, account, payload("Legacy client still writes"), 1).status_code == 200


def test_preferences_auth_and_account_isolation(env):
    _, client = env
    assert client.get("/v1/sync/preferences").status_code == 401
    assert client.post("/v1/sync/preferences", json={}).status_code == 401
    a, b = register(env, "alice"), register(env, "bobby")
    assert client.get("/v1/sync/preferences", headers=headers(a)).json() == {"record": None}
    assert save(client, a).status_code == 200
    assert client.get("/v1/sync/preferences", headers=headers(b)).json() == {"record": None}
    assert "preferences-v1" in client.get("/v1/health").json()["features"]
    assert client.get("/v1/sync/manifest", headers=headers(a)).json()["records"] == []
    assert client.post("/v1/sync/pull", headers=headers(a), json={"keys": ["preferences:keys"]}).status_code == 400


def test_preferences_cas_idempotency_and_opaque_storage(env):
    repo, client = env
    a = register(env)
    first = save(client, a).json()["record"]
    assert first["version"] == 1
    assert save(client, a).json()["record"] == first
    changed = bundle()
    changed["settings"]["theme"] = "dark"
    assert save(client, a, changed, 1).json()["record"]["version"] == 2
    assert save(client, a, bundle(), 1).status_code == 409
    with repo.connection() as db:
        row = db.execute("SELECT payload,bytes FROM account_preferences").fetchone()
        assert row["bytes"] == len(row["payload"].encode())
        assert "opaque-test-ciphertext" not in row["payload"]


@pytest.mark.parametrize("location", ["model", "embedding", "envelope", "settings", "bundle", "skill"])
def test_plaintext_or_unknown_fields_cannot_enter_preferences(env, location):
    _, client = env
    a = register(env)
    data = bundle()
    target = {"model": data["settings"]["models"][0], "embedding": data["settings"]["embedding"], "envelope": data["vault"], "settings": data["settings"], "bundle": data}
    if location == "skill":
        data["settings"]["skills"] = [{"id": "bad", "apiKey": "plaintext-fixture"}]
    else:
        target[location]["apiKey"] = "plaintext-fixture"
    assert save(client, a, data).status_code == 400
    assert client.get("/v1/sync/preferences", headers=headers(a)).json()["record"] is None


@pytest.mark.parametrize("mutation", ["kdf", "iterations", "salt", "iv", "ciphertext", "url", "assignment", "duplicate", "boolean-version"])
def test_invalid_formats_do_not_replace_config(env, mutation):
    _, client = env
    a = register(env)
    assert save(client, a).status_code == 200
    data = copy.deepcopy(bundle())
    if mutation in ("kdf", "salt", "iv", "ciphertext"):
        data["vault"][mutation] = "invalid"
    elif mutation == "iterations":
        data["vault"]["iterations"] = 1
    elif mutation == "url":
        data["settings"]["models"][0]["baseUrl"] = "https://example.test?api_key=fixture"
    elif mutation == "assignment":
        data["settings"]["assignments"]["writing"] = "missing"
    elif mutation == "duplicate":
        data["settings"]["models"].append(data["settings"]["models"][0])
    assert save(client, a, data, True if mutation == "boolean-version" else 1).status_code == 400
    assert client.get("/v1/sync/preferences", headers=headers(a)).json()["record"]["version"] == 1


def test_preferences_and_documents_share_quotas_in_both_directions(env, monkeypatch):
    repo, client = env
    a = register(env)
    size = len(json.dumps(bundle()).encode())
    with repo.connection(True) as db:
        db.execute("UPDATE users SET quota=? WHERE id=?", (size + 1, a["user"]["id"]))
    assert save(client, a).status_code == 200
    assert push(client, a, payload()).status_code == 413
    b = register(env, "bobby")
    assert push(client, b, payload()).status_code == 200
    with repo.connection(True) as db:
        db.execute("UPDATE users SET quota=? WHERE id=?", (size, b["user"]["id"]))
    assert save(client, b).status_code == 413
    monkeypatch.setenv("SYNC_GLOBAL_QUOTA", str(size + len(payload().encode()) + 1))
    larger = bundle()
    larger["settings"]["models"][0]["name"] = "x" * 200
    assert save(client, a, larger, 1).status_code in (413, 507)


def test_skill_timestamps_and_limits_match_client(env):
    _, client = env
    a = register(env)
    data = bundle()
    data["settings"]["skills"] = [{"id": "custom", "name": "技能", "description": "", "task": "writing", "instructions": "x" * 5000,
                                      "enabled": True, "builtIn": False, "createdAt": "2026-10-17T00:00:00Z", "updatedAt": "2026-10-17T00:00:00Z"}]
    assert save(client, a, data).status_code == 200
