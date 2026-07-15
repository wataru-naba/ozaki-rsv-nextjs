# Default Branch Policy

## Protected branches

Do not commit directly to:

- `main`
- `master`
- `develop`
- `development`
- `mvp`
- `staging`
- `stg`
- `release`
- `release/*`

Repository-specific rules override this list only when they are stricter. Never weaken a documented repository protection rule.

## Allowed work branches

- `feature/US-<id>-<description>`: product user story work
- `mvp/feature/<description>`: MVP hypothesis-validation work
- `fix/<description>`: defect correction
- `refactor/<description>`: behavior-preserving restructuring
- `test/<description>`: test-only work
- `docs/<description>`: documentation work
- `chore/<description>`: maintenance with no product behavior change

## Atomic commit rule

A commit must represent one reviewable purpose. Implementation, tests, migrations, and documentation may be included together when they are all necessary for the same purpose.

Block unrelated cleanup, formatting, dependency upgrades, generated artifacts, or opportunistic fixes unless the branch purpose explicitly includes them.
