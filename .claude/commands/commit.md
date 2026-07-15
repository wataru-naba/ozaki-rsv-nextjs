---
description: "Conventional Commit形式でコミットを作成"
allowed-tools: ["Bash(git add:*)", "Bash(git status:*)", "Bash(git commit:*)", "Bash(git diff:*)"]
---
# Commit

1. `git status`と`git diff`でステージ済み変更を確認
2. 変更内容が複数の論点にまたがる場合は分割を提案
3. Conventional Commits形式でコミットメッセージを作成
   - 例: feat(auth): add password reset flow
4. AI署名は含めない
