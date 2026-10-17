# 私有开发仓库、跨电脑同步与自动备份

源码开发目标：`HannJia/novel-ai-studio-dev`（私有）。公开发布目标仍为 `HannJia/novel-ai-studio`。

## 两个远程仓库

- `origin`：私有开发仓库。日常 `git pull` / `git push` 和自动备份只使用这里。
- `public`：现有公开仓库。仅在明确执行正式版本发布时使用。

`package.json` 的 `build.publish`、仓库展示链接和 `app-main/updater.cjs` 的更新地址继续指向公开仓库。不要把客户端更新地址改成私有开发仓库，也不要给客户端加入 GitHub Token。

## 在另一台 Windows 电脑上开发

先安装 Git，使用自己的 GitHub 账号完成 Git Credential Manager 登录，然后执行：

```powershell
git clone https://github.com/HannJia/novel-ai-studio-dev.git
cd novel-ai-studio-dev
git remote add public https://github.com/HannJia/novel-ai-studio.git
git config remote.pushDefault origin
git config push.default simple
git config push.followTags false
git config user.name HannJia
git config user.email 84705494+HannJia@users.noreply.github.com
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install-git-auto-backup.ps1
npm ci
```

每次换电脑前，把准备共享的代码提交到开发分支并上传；在另一台电脑开始工作前，确保工作区已妥善保存，再拉取最新提交：

```powershell
git pull --ff-only origin main
# 完成修改后，明确选择需要提交的源码文件；不要加入私人资料。
git add <需要提交的文件>
git commit -m "说明这次修改"
git push origin main
```

如果拉取或推送被拒绝，先比较两台电脑的修改，再合并。不要强推覆盖另一台电脑的提交。自动备份不会替你执行 pull、合并、rebase 或改写开发分支。

## 自动备份与恢复

每次登录及每 30 分钟检查已跟踪文件，有变化时生成本地快照，再上传到私有仓库的 `backup/auto-<计算机名>` 分支。新文件需要先手动 `git add` 才纳入快照。备份不会改动当前分支、HEAD 或暂存区。

上传前验证目标仓库仍为预期私有仓库；验证失败、登录失效、网络中断时保留本地快照，下次重试。敏感文件名或常见密钥格式命中时整次快照停止。不要向任一仓库加入真实密钥、凭据、邀请信息、数据库、稿件、PDF 或 OCR 输出。

未提交的自动快照在备份分支中，普通 `git pull origin main` 不会将它自动应用到工作区。跨电脑恢复此类快照时，先检查远程备份分支，再选择需要的文件：

```powershell
git fetch origin
git branch -r --list 'origin/backup/*'
git log --oneline origin/backup/auto-<原电脑名>
git diff main origin/backup/auto-<原电脑名> -- <文件>
# 确认不会覆盖未保存内容后，再恢复指定文件：
git restore --source=origin/backup/auto-<原电脑名> -- <文件>
```

任务名：`NovelAIStudio-GitAutoBackup`。仅在当前用户登录期间运行；关机时不执行，登录后补查。日志位于 `.local-recovery/git-auto-backup/backup.log`，不会提交。检查 `Get-ScheduledTaskInfo -TaskName NovelAIStudio-GitAutoBackup` 的 `LastTaskResult`，`0` 表示成功。

手动执行：`powershell -NoProfile -ExecutionPolicy Bypass -File scripts/git-auto-backup.ps1`。停用：`Disable-ScheduledTask -TaskName NovelAIStudio-GitAutoBackup`。调整频率：`powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install-git-auto-backup.ps1 -IntervalMinutes 60`。只保留本地快照：重新安装时加 `-LocalOnly`。

## 正式公开发布

按 [自动更新与版本发布](auto-update.md) 完成版本号、测试、构建、安装包和更新清单验证后，将审核后的正式版本提交和对应标签明确推送到 `public`：

```powershell
git push public main
git push public v<版本号>
```

创建 Release 时必须显式指定 `HannJia/novel-ai-studio`（例如 GitHub CLI 的 `--repo HannJia/novel-ai-studio`），先草稿上传并验证资产，再发布。不要使用 `git push --all`、`--mirror` 或将自动备份分支推送到公开仓库。

公开发布源码会公开该提交及其祖先历史；需要公开发布的开发历史中同样不得包含私人资料。私有仓库不会撤回以前已在公开仓库发布的源码。
