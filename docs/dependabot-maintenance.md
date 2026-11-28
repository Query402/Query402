# Dependabot maintenance and security updates

Issue [#223](https://github.com/Query402/Query402/issues/223) has two halves. The
configuration half is committed as
[`.github/dependabot.yml`](../.github/dependabot.yml). The repository-settings
half — **Dependabot alerts** and **Dependabot security updates** — cannot be
committed: a repository administrator has to enable it, and committing this file
does **not** change any GitHub setting.

## What the committed configuration does

| Setting                 | npm                                                                          | GitHub Actions                   |
| ----------------------- | ---------------------------------------------------------------------------- | -------------------------------- |
| Directory               | `/` (the workspace root lockfile covers `apps/*` and `packages/*`)           | `/`                              |
| Schedule                | Weekly                                                                       | Weekly                           |
| Open version-update PRs | 5                                                                            | 3                                |
| Grouping                | `compatible-npm`: all packages, `minor` and `patch` **version updates** only | None                             |
| Labels                  | `dependencies`, `javascript`                                                 | `dependencies`, `github_actions` |

Two absences are deliberate:

- **No `target-branch`.** Updates already open against the default branch,
  `main`. Setting the key would also switch Dependabot _security_ updates off
  for this configuration, because security updates only ever target the default
  branch — the opposite of what this issue asks for.
- **No `update-types` on the group beyond `minor` and `patch`, and
  `applies-to: version-updates`.** A major bump and a security fix each arrive
  as their own pull request, so neither can be merged as a side effect of a
  routine batch.

Labels are pinned rather than left to the default because the issue asks for
existing repository labels only. Without a `labels` key Dependabot applies its
defaults and creates any that are missing — which is how `dependencies`,
`javascript` and `github_actions` came to exist here. Naming them stops a future
ecosystem from inventing another one.

## Enablement process (repository administrator)

1. Open the `Query402/Query402` repository settings and select **Code security**
   (older layouts: **Code security and analysis**).
2. Enable **Dependabot alerts**.
3. Enable **Dependabot security updates**. It depends on alerts, so step 2 has
   to come first.
4. Leave **Dependabot version updates** as the committed
   `.github/dependabot.yml` describes; the file is the source of truth for the
   schedule, limits, grouping and labels.
5. Review the first batch of alerts in the repository's **Security** tab. Do not
   paste advisory contents, affected paths or dependency trees into public issue
   comments while a fix is pending.

## Verification read-back

Both states are readable over the REST API with an administrator token. The
status code is the answer, so request the headers:

```bash
# Dependabot alerts: 204 = enabled, 404 = disabled
gh api --include repos/Query402/Query402/vulnerability-alerts

# Dependabot security updates: 200 with enabled:true, 404 = disabled
gh api repos/Query402/Query402/automated-security-fixes
```

A non-administrator token also receives `404`, so a `404` read by a contributor
is not evidence on its own — only an administrator's read-back settles it.

## Current state

Read on 2026-11-27 with a non-administrator token, which is why each row records
the response rather than claiming a setting:

| Control                               | Response                                                                  | Reading                                   |
| ------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------- |
| Dependabot alerts                     | `404` from `/vulnerability-alerts`                                        | Not enabled, or not visible to this token |
| Dependabot security updates           | `404` from `/automated-security-fixes`                                    | Not enabled, or not visible to this token |
| Version updates (npm, GitHub Actions) | Dependabot has opened grouped and individual pull requests against `main` | Working from the committed configuration  |

The third row is the one thing a contributor can confirm from outside: version
updates are demonstrably running, so the configuration is being read. Until an
administrator completes steps 2 and 3 above and records the read-back, the
security-update half of #223 stays unverified.
