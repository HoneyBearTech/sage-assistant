# Governance

Sage is a personal open-source project with a single maintainer. This document says how decisions are
made, who does what, and how the project carries on if the maintainer can't.

## Decision model

Sage follows a "benevolent dictator" model: the maintainer makes the final call on every decision,
including what is in scope, which pull requests are merged, and when a release is made.

Decisions happen in the open wherever possible:

- **Bugs, features and questions** are discussed in
  [GitHub Issues](https://github.com/HoneyBearTech/sage-assistant/issues). Anyone can open one or comment.
- **Changes** land only through pull requests to `main`. The pull request description records what changed
  and why.
- **Releases**, once there are any, will be SemVer version tags, with what each one changed in
  [CHANGELOG.md](CHANGELOG.md).
- **Larger design choices** are explained in the issues and pull requests that make them, and in the
  [roadmap](docs/roadmap.md).
- **Security reports** are handled privately, as described in [SECURITY.md](SECURITY.md), until a fix is
  released.

## Roles

| Role | Who | Responsibilities |
| --- | --- | --- |
| Maintainer | HoneyBearTech ([@HoneyBearTech](https://github.com/HoneyBearTech)) | Triage issues; review and merge pull requests; keep dependencies and documentation current; respond to vulnerability reports as described in [SECURITY.md](SECURITY.md); enforce the [Code of Conduct](CODE_OF_CONDUCT.md); keep this document up to date. |
| Contributor | Anyone who opens an issue or pull request | Follow [CONTRIBUTING.md](CONTRIBUTING.md) (coding standards, tests, sign-off) and the [Code of Conduct](CODE_OF_CONDUCT.md); report vulnerabilities privately; never post keys. |
| Security reporter | Anyone who reports a vulnerability | Report privately and allow time for a fix before disclosing, as described in [SECURITY.md](SECURITY.md). |

## Access to sensitive resources

| Resource | Who has access |
| --- | --- |
| Repository administration (settings, rules, merging) | the maintainer |
| Security advisories and private vulnerability reports | the maintainer |

There are no other collaborators, no CI secrets and no signing keys yet. The Windows installer job will
add a build and, later, signing; this table is updated in the same pull request.

## Granting elevated access

Nobody gets write, maintain or admin access without this review:

1. The person has a public track record with the project: several merged pull requests of good quality over
   at least three months, and participation in reviews or issues.
2. Their identity is established: a GitHub account with history, two-factor authentication on, and a way
   for the maintainer to confirm who they are.
3. The maintainer decides, records the decision and the role in a pull request that updates the tables in
   this file, and grants the least access that role needs.
4. Access is removed when someone steps back or is inactive for a year, also by a pull request here.

## Continuity

If the maintainer can no longer support the project, it must be able to carry on (issues triaged, changes
accepted, releases made) within a week. The maintainer keeps the credentials of the GitHub account that
owns the repository, and its recovery codes, in a password manager with emergency access for a trusted
person. Because Sage is MIT-licensed, anyone may also fork it and carry on under another name.
