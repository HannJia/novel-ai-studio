#!/bin/sh
set -eu
cd /opt/novel-sync/app
mountpoint -q /srv/novel-data
getent passwd novel-sync >/dev/null || useradd --system --home /nonexistent --shell /usr/sbin/nologin novel-sync
install -d -o novel-sync -g novel-sync -m 700 /srv/novel-data/cloud
install -d -m 700 /var/backups/novel-sync
python3 -m venv /opt/novel-sync/venv
/opt/novel-sync/venv/bin/pip install -r server/requirements.txt
install -m 644 server/deploy/novel-sync.service /etc/systemd/system/novel-sync.service
install -m 644 server/deploy/novel-cert-renew.service /etc/systemd/system/novel-cert-renew.service
install -m 644 server/deploy/novel-cert-renew.timer /etc/systemd/system/novel-cert-renew.timer
install -m 644 server/deploy/novel-sync-backup.service /etc/systemd/system/novel-sync-backup.service
install -m 644 server/deploy/novel-sync-backup.timer /etc/systemd/system/novel-sync-backup.timer
install -m 644 server/deploy/fail2ban.conf /etc/fail2ban/jail.d/novel-sync.conf
install -m 644 server/deploy/nginx.conf /etc/nginx/sites-available/novel-sync
if [ -L /etc/nginx/sites-enabled/default ]; then
    unlink /etc/nginx/sites-enabled/default
fi
ln -sf /etc/nginx/sites-available/novel-sync /etc/nginx/sites-enabled/novel-sync
nginx -t
systemctl daemon-reload
systemctl enable --now novel-sync.service novel-cert-renew.timer novel-sync-backup.timer fail2ban
systemctl reload nginx
systemctl restart fail2ban
systemctl start novel-sync-backup.service
systemctl is-active novel-sync nginx fail2ban
