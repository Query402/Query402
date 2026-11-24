# Main branch protection

Issue [#228](https://github.com/Query402/Query402/issues/228) is delivered as an
[importable ruleset](../.github/rulesets/main.json). Committing this file does **not** change
GitHub settings. A repository administrator must apply it after the prerequisites below.
Application to the upstream repository is **pending**; this document does not claim live enforcement.

## Intended final settings

| Setting                                          | Value                                           |
| ------------------------------------------------ | ----------------------------------------------- |
| Name                                             | `main: reviewed changes and CI`                 |
| Target                                           | Branch `refs/heads/main` only; no exclusions    |
| Enforcement                                      | Active when applied                             |
| Pull request required                            | Yes                                             |
| Approvals                                        | At least one                                    |
| Dismiss stale approvals on new reviewable pushes | Yes                                             |
| Required check                                   | `quality`, from GitHub Actions (app ID `15368`) |
| Require up-to-date branch                        | Yes                                             |
| Force pushes                                     | Blocked                                         |
| Branch deletion                                  | Blocked                                         |
| Bypass actors                                    | None, including administrators                  |

No bypass is the minimum privilege policy. Before activation, ensure a second eligible reviewer
can approve a maintainer-authored PR: authors cannot approve their own PRs. A sole maintainer
needs another reviewer; do not silently add a broad administrator bypass to work around this.
Any future emergency exception needs an explicit maintainer decision and a separate audit record.

## Prerequisites: resolve the CI ambiguity first

Inspection on 2026-10-21 UTC at main commit `c9be57e` found:

- `main` is reported protected, but its public branch response has no required check contexts.
- No repository rulesets were returned. Full classic-protection settings were not accessible to
  the contributor, so approval and bypass settings could not be independently established.
- Both `.github/workflows/ci.yml` and `.github/workflows/quality.yml` publish `quality`.
  The former runs npm quality gates; the latter still runs pnpm. Both checks on that commit failed:
  [CI](https://github.com/Query402/Query402/actions/runs/36792979034) and
  [CI / quality](https://github.com/Query402/Query402/actions/runs/36792979006).
- Both check runs identify GitHub Actions as app `15368`. This is an application identifier,
  not a contributor account identifier. The required context is `quality`, not the workflow
  title `CI`, `CI / quality`, or the optional `demo-transcript` job.

**Do not activate this ruleset until [#219](https://github.com/Query402/Query402/issues/219)
has consolidated the workflows and a fresh pull request reports one unambiguous, successful
quality gate.** Confirm that gate covers typecheck, build, test, lint, format and source-artifact
checks and runs on every PR targeting main, without path filters or conditions that skip it.

Use a recent PR's head SHA to inspect the actual check-run name and source:

```bash
gh api repos/Query402/Query402/commits/PR_HEAD_SHA/check-runs --paginate \
  --jq '.check_runs[] | {name, status, conclusion, app_id: .app.id, details_url}'
```

The supplied `quality` context is based on observed check runs, not a guessed future name.
If #219 renames the job, update `context` in the JSON to the exact reported name and verify its
app ID before import. Do not require both duplicate jobs or drop the required check to make
merges work. A missing, renamed or permanently skipped check can block merges indefinitely.

## Apply (administrator)

1. Complete the prerequisites and review the JSON. Export existing rulesets and inspect classic
   branch protection first; preserve stricter existing requirements. Rulesets and classic
   protection can apply together, so check the effective settings rather than assuming replacement.
2. In the upstream repository's **Settings → Rules → Rulesets**, choose **New ruleset → Import a
   ruleset** and select `.github/rulesets/main.json`. Review the target, check source and empty
   bypass list, then save. The file requests **active** enforcement immediately on application.
3. Alternatively, use an already-authenticated administrator's GitHub CLI from the repository root:

   ```bash
   gh api --method POST repos/Query402/Query402/rulesets \
     --input .github/rulesets/main.json --jq '{id, name, enforcement}'
   ```

   Record the returned ruleset ID. If this ruleset already exists, inspect it and use `PUT` on
   `repos/Query402/Query402/rulesets/RULESET_ID` with the same input instead of creating a duplicate.
   Do not remove another ruleset or disable existing branch protections as part of this operation.

## Verify and record the applied settings

Read back the saved ruleset and effective main rules:

```bash
gh api repos/Query402/Query402/rulesets/RULESET_ID \
  --jq '{id, name, target, enforcement, conditions, rules, bypass_actors}'
gh api repos/Query402/Query402/rules/branches/main
```

Check every value against the table. With a disposable PR targeting main, verify:

- Before approval, GitHub blocks merge even when `quality` succeeds.
- After approval and a successful check, all required conditions are satisfied.
- A subsequent reviewable commit dismisses the previous approval and starts a fresh quality check.
- A failing or pending quality check blocks merge. A branch behind main requires updating.

Verify force-push and deletion restrictions through the saved/effective rules; **do not attempt
to delete or force-push main to test them**. Review any inherited rules and bypasses in Settings.
Do not merge the disposable PR merely to test the configuration.

Append the applied UTC timestamp, ruleset ID, consolidated-CI PR/run URL, observed check name/app,
and verification outcomes to this document once applied. Until then, #228 still needs administrator
application and live verification. Keep the record limited to settings and public evidence:
no tokens, authentication output, personal account details or unredacted account screenshots.

References: [GitHub ruleset import and creation](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/creating-rulesets-for-a-repository)
and [repository rules REST API](https://docs.github.com/en/rest/repos/rules).
