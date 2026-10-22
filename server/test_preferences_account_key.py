import base64
import gzip
import shutil
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient

from server.app import create_app
from server.manage import main
from server.preferences import ensure_master_key
from server.test_preferences import bundle, save
from server.test_server import env, headers, register


def get_key(client, account):
    response = client.get('/v1/sync/preferences/key', headers=headers(account))
    assert response.status_code == 200, response.text
    assert response.headers['cache-control'] == 'no-store'
    value = response.json()
    assert value['schema'] == 1 and len(base64.b64decode(value['key'], validate=True)) == 32
    return value['key']


def test_key_is_authenticated_stable_and_account_isolated(env):
    repo, client = env
    assert client.get('/v1/sync/preferences/key').status_code == 401
    a, b = register(env), register(env, 'otherauthor')
    key = get_key(client, a)
    assert get_key(client, a) == key
    assert get_key(client, b) != key
    with TestClient(create_app(repo.directory)) as reopened:
        assert get_key(reopened, a) == key
    with repo.connection() as db:
        contents = '\n'.join(str(tuple(row)) for row in db.execute('SELECT * FROM server_settings'))
    assert key not in contents
    assert key not in (repo.directory / 'preferences-master.key').read_bytes().hex()


def test_account_key_survives_password_change_but_old_login_is_revoked(env):
    _, client = env
    account = register(env)
    key = get_key(client, account)
    changed = client.post('/v1/auth/password', headers=headers(account), json={
        'currentPassword': 'test-password-123', 'password': 'new-test-password-123'})
    assert changed.status_code == 200
    assert client.get('/v1/sync/preferences/key', headers=headers(account)).status_code == 401
    new_login = client.post('/v1/auth/login', json={'username': 'author', 'password': 'new-test-password-123'}).json()
    assert get_key(client, new_login) == key


def test_simultaneous_first_requests_publish_one_complete_key(env):
    repo, _ = env
    with ThreadPoolExecutor(max_workers=4) as workers:
        masters = list(workers.map(lambda _: ensure_master_key(repo), range(4)))
    assert len(masters[0]) == 32 and all(master == masters[0] for master in masters)
    assert (repo.directory / 'preferences-master.key').read_bytes() == masters[0]
    assert not list(repo.directory.glob('.preferences-master-*'))


def test_managed_preferences_use_existing_cas_and_keep_legacy_support(env):
    _, client = env
    account = register(env)
    get_key(client, account)
    data = bundle(); data['schema'] = 2
    first = save(client, account, data).json()['record']
    assert first['version'] == 1
    assert save(client, account, data).json()['record']['version'] == 1
    changed = bundle(); changed['schema'] = 2; changed['settings']['theme'] = 'dark'
    assert save(client, account, changed).status_code == 409
    assert save(client, account, changed, 1).status_code == 200
    other = register(env, 'legacyuser')
    assert save(client, other).status_code == 200


@pytest.mark.parametrize('damage', ['missing', 'corrupt', 'wrong-key'])
def test_missing_or_wrong_master_fails_closed_without_touching_records(env, damage):
    repo, client = env
    account = register(env)
    get_key(client, account)
    data = bundle(); data['schema'] = 2
    assert save(client, account, data).status_code == 200
    path = repo.directory / 'preferences-master.key'
    if damage == 'missing':
        path.unlink()
    else:
        path.write_bytes(b'x' if damage == 'corrupt' else b'x' * 32)
    assert client.get('/v1/sync/preferences/key', headers=headers(account)).status_code == 503
    assert save(client, account, data, 1).status_code == 503
    assert client.get('/v1/sync/preferences', headers=headers(account)).json()['record']['version'] == 1
    assert client.get('/v1/sync/manifest', headers=headers(account)).status_code == 200
    if damage == 'missing':
        assert not path.exists()


def run_backup(monkeypatch, repo, directory):
    monkeypatch.setattr('sys.argv', ['server.manage', '--data-dir', str(repo.directory), 'backup', '--directory', str(directory)])
    main()


def test_paired_backup_restores_the_same_account_key_and_prunes_pairs(env, tmp_path, monkeypatch, capsys):
    repo, client = env
    account = register(env)
    key = get_key(client, account)
    data = bundle(); data['schema'] = 2
    assert save(client, account, data).status_code == 200
    backups = tmp_path / 'backups'
    for _ in range(4):
        run_backup(monkeypatch, repo, backups)
    snapshots = sorted(backups.glob('sync-*.sqlite3.gz'))
    assert len(snapshots) == 3
    assert len(list(backups.glob('*.preferences-key'))) == 3
    latest = snapshots[-1]
    sidecar = backups / (latest.name + '.preferences-key')
    restored_dir = tmp_path / 'restored'; restored_dir.mkdir()
    with gzip.open(latest, 'rb') as source, (restored_dir / 'sync.sqlite3').open('wb') as target:
        shutil.copyfileobj(source, target)
    shutil.copyfile(sidecar, restored_dir / 'preferences-master.key')
    with TestClient(create_app(restored_dir)) as restored:
        assert get_key(restored, account) == key
        assert restored.get('/v1/sync/preferences', headers=headers(account)).json()['record']['version'] == 1
    assert key not in capsys.readouterr().out


def test_backup_rejects_a_database_without_its_matching_master(env, tmp_path, monkeypatch):
    repo, client = env
    account = register(env)
    get_key(client, account)
    (repo.directory / 'preferences-master.key').unlink()
    backups = tmp_path / 'bad-backups'
    with pytest.raises(RuntimeError, match='master key'):
        run_backup(monkeypatch, repo, backups)
    assert not list(backups.glob('*.sqlite3.gz'))


def test_does_not_generate_master_when_schema_two_exists_without_metadata(env):
    repo, client = env
    account = register(env)
    data = bundle(); data['schema'] = 2
    assert save(client, account, data).status_code == 200
    with repo.connection(True) as db:
        db.execute("DELETE FROM server_settings WHERE key='preferences_master_verifier'")
    (repo.directory / 'preferences-master.key').unlink()
    assert client.get('/v1/sync/preferences/key', headers=headers(account)).status_code == 503
    assert not (repo.directory / 'preferences-master.key').exists()
