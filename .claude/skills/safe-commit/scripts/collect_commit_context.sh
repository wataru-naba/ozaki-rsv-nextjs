#!/usr/bin/env bash
set -eu

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo '{"error":"not_a_git_repository"}'
  exit 2
fi

branch=$(git branch --show-current)
if [ -z "$branch" ]; then
  branch="DETACHED_HEAD"
fi

protected="false"
case "$branch" in
  main|master|develop|development|mvp|staging|stg|release|release/*)
    protected="true"
    ;;
esac

staged_count=$(git diff --cached --name-only | awk 'NF {count++} END {print count+0}')

printf '%s\n' '=== SAFE COMMIT CONTEXT ==='
printf 'branch: %s\n' "$branch"
printf 'protected_branch: %s\n' "$protected"
printf 'staged_file_count: %s\n' "$staged_count"
printf '%s\n' '--- status ---'
git status --short
printf '%s\n' '--- staged files ---'
git diff --cached --name-status
printf '%s\n' '--- staged summary ---'
git diff --cached --stat
printf '%s\n' '--- staged diff ---'
git diff --cached --no-ext-diff --unified=3
printf '%s\n' '--- recent commits ---'
git log -5 --pretty=format:'%h %s' 2>/dev/null || true
printf '\n%s\n' '=== END SAFE COMMIT CONTEXT ==='

if [ "$protected" = "true" ]; then
  exit 10
fi

if [ "$staged_count" -eq 0 ]; then
  exit 11
fi
