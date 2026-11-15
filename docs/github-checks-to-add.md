# GitHub checks to add

Nothing runs on GitHub for this repository yet: every check runs locally with `npm run verify`. This
page holds ready-to-paste files and settings for the maintainer to add by hand, in one pull request for
the workflow files and then in the repository settings. Each workflow uses the least permissions it
needs, and every action is pinned to a full commit SHA (with the version in a comment) so a moved tag
can't change what runs.

Before pasting, check that each pinned SHA is still the latest release of its action (the Scorecard and
Dependabot or Renovate can keep them current afterwards).

## 1. CI: `npm run verify` on Ubuntu and Windows

`.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

permissions:
  contents: read

jobs:
  verify:
    name: verify (${{ matrix.os }})
    runs-on: ${{ matrix.os }}
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, windows-latest]
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7
        with:
          fetch-depth: 0
          persist-credentials: false

      - uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7
        with:
          node-version: 24
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Lint, format, typecheck, tests with coverage, public-repo check
        run: npm run verify

      - name: Dependency audit
        run: npm audit --audit-level=high
```

`npm run verify` also runs the secret scan, which skips itself with a message on runners without
gitleaks; the dedicated secret-scan workflow below covers it. The tests don't start Electron, so the
runners don't download its runtime.

## 2. DCO sign-off

`.github/workflows/dco.yml`:

```yaml
name: DCO

# Every commit in a pull request must carry a Developer Certificate of Origin sign-off
# ("Signed-off-by: Name <email>", added by `git commit -s`); see CONTRIBUTING.md.
# Dependabot's and Renovate's commits and merge commits are exempt.

on: pull_request

permissions:
  contents: read

jobs:
  dco:
    name: DCO sign-off
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: read
    steps:
      - name: Check that every commit is signed off
        env:
          GH_TOKEN: ${{ github.token }}
          REPO: ${{ github.repository }}
          PR: ${{ github.event.pull_request.number }}
        run: |
          set -euo pipefail
          unsigned=$(gh api --paginate "repos/$REPO/pulls/$PR/commits" --jq '
            .[]
            | select((.author.login // "") | IN("dependabot[bot]", "renovate[bot]") | not)
            | select((.parents | length) < 2)
            | select(.commit.message | split("\n") | any(test("^Signed-off-by: [^<>]+ <[^<>]+>\\s*$")) | not)
            | "\(.sha[0:12]) \(.commit.message | split("\n")[0])"')
          if [ -n "$unsigned" ]; then
            echo "These commits have no 'Signed-off-by: Name <email>' line:"
            echo "$unsigned"
            echo "Sign them off with 'git rebase --signoff <base>' and force-push; see CONTRIBUTING.md."
            exit 1
          fi
          echo "Every commit is signed off."
```

## 3. Secret scan

`.github/workflows/secret-scan.yml` (the same gitleaks version as `npm run secret-scan`, with its
download checked against the published SHA-256):

```yaml
name: Secret scan

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

permissions:
  contents: read

jobs:
  gitleaks:
    name: Secret scan
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7
        with:
          fetch-depth: 0
          persist-credentials: false

      - name: Install gitleaks
        env:
          VERSION: 8.30.1
          SHA256: 551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb
        run: |
          set -euo pipefail
          file="gitleaks_${VERSION}_linux_x64.tar.gz"
          curl -sSfL -o "$file" "https://github.com/gitleaks/gitleaks/releases/download/v${VERSION}/${file}"
          echo "${SHA256}  ${file}" | sha256sum -c -
          tar xzf "$file" gitleaks

      - name: Scan for secrets
        run: ./gitleaks git --redact --no-banner --exit-code 1 --config .gitleaks.toml .
```

Also turn on **Settings → Code security → Secret scanning** and **Push protection**.

## 4. CodeQL

`.github/workflows/codeql.yml`:

```yaml
name: CodeQL

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
  schedule:
    - cron: "30 1 * * 0"

permissions:
  contents: read

jobs:
  analyze:
    name: Analyze (javascript-typescript)
    runs-on: ubuntu-latest
    permissions:
      security-events: write
      packages: read
      actions: read
      contents: read
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7
        with:
          persist-credentials: false

      - uses: github/codeql-action/init@6f2ac81f5cd81fe351a197ba0b00d91d03cd2aee # v4
        with:
          languages: javascript-typescript
          build-mode: none

      - uses: github/codeql-action/analyze@6f2ac81f5cd81fe351a197ba0b00d91d03cd2aee # v4
        with:
          category: "/language:javascript-typescript"
```

## 5. Dependency review

`.github/workflows/dependency-review.yml` (fails a pull request that adds a dependency with a known
vulnerability of moderate severity or worse, or a licence outside the permissive list):

```yaml
name: Dependency review

on: pull_request

permissions:
  contents: read

jobs:
  dependency-review:
    name: Dependency review
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7
        with:
          persist-credentials: false
      - uses: actions/dependency-review-action@a1d282b36b6f3519aa1f3fc636f609c47dddb294 # v5.0.0
        with:
          fail-on-severity: moderate
          allow-licenses: >-
            MIT, MIT-0, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, 0BSD, Zlib, Unlicense, CC0-1.0,
            BlueOak-1.0.0, Python-2.0, MPL-2.0, CC-BY-4.0, OFL-1.1
```

## 6. OpenSSF Scorecard

`.github/workflows/scorecard.yml`:

```yaml
name: OpenSSF Scorecard

on:
  push:
    branches: [main]
  schedule:
    - cron: "30 1 * * 6"

permissions: read-all

jobs:
  analysis:
    name: Scorecard analysis
    runs-on: ubuntu-latest
    permissions:
      security-events: write
      id-token: write
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7
        with:
          persist-credentials: false

      - uses: ossf/scorecard-action@fa7117db83c52d787ae5a89f350999701505d78e # v2.5.0
        with:
          results_file: results.sarif
          results_format: sarif
          publish_results: true

      - uses: actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9 # v7
        with:
          name: SARIF file
          path: results.sarif
          retention-days: 5

      - uses: github/codeql-action/upload-sarif@6f2ac81f5cd81fe351a197ba0b00d91d03cd2aee # v4.39.0
        with:
          sarif_file: results.sarif
```

## 7. CODEOWNERS

`.github/CODEOWNERS`, one line:

```text
* @HoneyBearTech
```

## 8. Branch rule for `main`

In **Settings → Rules → Rulesets → New branch ruleset**, targeting the default branch:

- **Enforcement:** Active. **Bypass list:** empty.
- **Restrict deletions** and **Block force pushes**: on.
- **Require a pull request before merging**: on, with **Require review from Code Owners** and
  **Dismiss stale pull request approvals when new commits are pushed**. With one maintainer, set the
  required approvals to 0 so the owner can merge their own reviewed changes.
- **Require status checks to pass**, with **Require branches to be up to date before merging**, and these
  checks:
  - `verify (ubuntu-latest)`
  - `verify (windows-latest)`
  - `DCO sign-off`
  - `Secret scan`
  - `Analyze (javascript-typescript)`
  - `Dependency review`
- **Require linear history**: on (squash or rebase merges).

Also turn on **Settings → Code security → Private vulnerability reporting**, which
[SECURITY.md](../SECURITY.md) relies on.

## After adding them

Update [CONTRIBUTING.md](../CONTRIBUTING.md) (the "On GitHub" column of the checks table, and the DCO
section), the [README](../README.md#developing) and the repo's guidelines file, which say today that the
checks run only locally.
