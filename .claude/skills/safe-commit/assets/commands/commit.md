Validate and commit the currently staged changes using the safe-commit workflow.

Mandatory procedure:

1. Run the bundled `collect_commit_context.sh` script or equivalent Git commands to obtain:
   - current branch
   - `git status --short`
   - staged file list
   - staged diff and summary
   - recent commit messages
2. Read repository branch rules from `CLAUDE.md`, `.claude/`, `CONTRIBUTING.md`, and the safe-commit branch policy.
3. Infer the current branch purpose and compare it with every staged change.
4. Block the commit when the branch is protected, the branch purpose is ambiguous, changes have mixed purposes, or any staged change is outside scope.
5. When blocked, explain exact conflicts, suggest an appropriate branch name, and stop. Do not modify Git state.
6. When approved, generate a repository-conforming commit message and commit only the staged changes.
7. Report the final commit hash and message after success.

Never create or switch branches, stash, reset, restore, or move changes as part of this command.
