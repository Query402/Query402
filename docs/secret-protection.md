# GitHub Secret Protection

## Enablement Process

1. Open the `Query402/Query402` repository settings and select **Code security and analysis**.
2. Under **Secret Protection**, enable **Secret scanning** and **Push protection**.
3. Enable **Non-provider patterns** and **Validity checks** if GitHub makes those controls available for the repository.
4. Review the initial secret-scanning alerts in the repository's Security tab. Do not copy, quote, or post secret values in issue comments or other public messages. Handle any exposed credential through its provider's revocation and rotation process.
5. Confirm **Push protection** is enabled at the repository level and that no bypass or exclusion prevents it from applying to pushes targeting `main`.
6. Record completion using only the enabled/disabled state for each control and the `main` protection check. Do not include secret values, samples, or alert contents.

## Current State

The states below are unverified because the available GitHub account does not have repository administration access.

| Control | State |
| --- | --- |
| Secret scanning | Unverified |
| Push protection | Unverified |
| Non-provider patterns | Unverified |
| Validity checks | Unverified |
| Protection for pushes targeting `main` | Unverified |