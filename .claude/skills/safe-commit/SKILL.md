---
name: safe-commit
description: Validate whether staged Git changes belong on the current branch before committing. Use when the user runs or requests /commit, asks to commit staged changes, or wants a branch-aware pre-commit review. Automatically inspect the current branch, staged diff, status, recent commits, and repository branch policy; block commits on protected branches or when the staged changes do not match the branch purpose. Never move changes, create branches, or commit when validation fails.
---

# Safe Commit

Validate branch suitability before every commit. Treat the validation as a mandatory gate, not advisory output.

## Workflow

1. Run `scripts/collect_commit_context.sh` from the repository root.
2. Read `references/branch-policy.md` and any repository-specific rules in `CLAUDE.md`, `.claude/`, `CONTRIBUTING.md`, or equivalent files.
3. Infer the intended scope from the current branch name, linked ticket or user story, and recent commits.
4. Compare that scope with every staged file and the staged diff.
5. Return one of these decisions:
   - `APPROVED`: all staged changes clearly belong to the current branch.
   - `BLOCKED`: the branch is protected, scope is mixed, or any material change does not belong to the branch.
6. Only when the result is `APPROVED`, propose a commit message and perform the commit if explicitly requested.
7. When the result is `BLOCKED`, stop. Do not commit, create a branch, switch branches, stash, reset, restore, or modify files.

## Mandatory Checks

Block the commit when any condition applies:

- Current branch is `main`, `master`, `develop`, `development`, `mvp`, `staging`, `stg`, or a release branch designated as protected.
- There are no staged changes.
- The branch name does not communicate a work purpose and repository rules do not provide one.
- Staged changes contain multiple independent purposes.
- A file or code change is unrelated to the branch's ticket, user story, feature, fix, refactor, documentation task, or test task.
- Generated files, debug code, secrets, environment files, or unrelated formatting changes are mixed into the commit.
- A feature branch contains an unrelated bug fix, or a fix branch contains unrelated feature work.
- Tests required by the repository policy are missing or known to be failing.

Do not block solely because tests and implementation are committed together when they cover the same scope.

## Scope Interpretation

Interpret common branch patterns as follows:

- `feature/US-123-description`: only implementation, tests, and documentation required for user story `US-123`.
- `mvp/feature/description`: only MVP validation work for the named hypothesis or feature.
- `fix/issue-description`: only the defect correction, regression tests, and directly necessary documentation.
- `refactor/component`: behavior-preserving changes limited to the named component.
- `test/component`: tests and minimal fixtures or helpers needed for those tests.
- `docs/topic`: documentation-only changes unless repository policy explicitly permits examples or generated docs.

When branch naming differs, infer intent from the full branch name, issue references, conversation context, and recent commits. If intent remains ambiguous, block rather than guess.

## Output Format

For approval, return:

```text
Commit check: APPROVED
Branch: <branch>
Scope: <inferred scope>
Staged changes: <concise summary>
Commit message: <proposed message>
```

For rejection, return:

```text
Commit check: BLOCKED
Branch: <branch>
Expected scope: <inferred scope>
Conflicting changes:
- <file or change>: <reason>
Recommended branch: <branch-name suggestion>
Action: Commit was not executed.
```

Always identify the exact conflicting files or hunks when possible. Recommend a branch name, but do not create or switch to it.

## Commit Message

After approval, generate a concise message that reflects only the staged changes and follows repository conventions. Prefer an existing convention found in recent commits. Otherwise use:

```text
<type>(<scope>): <summary>
```

Use types such as `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, or `build`.

## Bundled Resources

- Run `scripts/collect_commit_context.sh` to collect branch and staged-change evidence without modifying the repository.
- Read `references/branch-policy.md` for the default branch policy.
- Copy `assets/commands/commit.md` to `.claude/commands/commit.md` when installing this workflow as a Claude Code `/commit` command.
