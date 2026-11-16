# Releasing

How a Sage release is built and published, and how anyone can check a downloaded installer. A release
is three files on the repository's [Releases page](https://github.com/HoneyBearTech/sage-assistant/releases):

| File | What it is |
| --- | --- |
| `Sage-Setup-<version>.exe` | The Windows installer (one click, for the current user, no admin rights). |
| `SHA256SUMS.txt` | The installer's SHA-256 checksum, to check the download wasn't damaged or swapped. |
| `Sage-Setup-<version>.sigstore.json` | The build provenance: a record, signed through GitHub, of which workflow run built the installer, from which commit. The same record is in the repository's attestations list. |

The installer isn't code-signed yet, so Windows SmartScreen warns about it (see
[installing.md](installing.md#installing-on-windows)). Signing is on the [roadmap](roadmap.md).

## The release workflow

The workflow below builds those three files on a GitHub Windows runner whenever a version tag such as
`v0.2.0` is pushed. The team doesn't add or change workflows, so the owner adds it once, as
`.github/workflows/release.yml`, through a pull request like any other change.

What it does, in order:

1. **build** (Windows): checks out the tagged commit, installs the exact dependencies (`npm ci`), runs
   `npm run verify`, checks that the tag is `v` plus the `version` in `package.json`, and builds the
   installer with `npm run dist`. It writes `SHA256SUMS.txt` for the one installer file, makes the build
   provenance for that file with `actions/attest`, and keeps the three files for the next job.
2. **release** (Linux): takes the three files and publishes the GitHub release with exactly those files.

How it is kept safe:

- **Least permissions.** Nothing is granted at the top. The build job can read the code and get a signing
  certificate for the provenance (`id-token: write`, `attestations: write`), but can't change the
  repository. Only the release job can write (`contents: write`), and it runs no project code.
- **Pinned actions.** Every action is pinned to a full commit ID with its version in a comment, so a
  moved tag can't change what runs. `actions/checkout` and `actions/setup-node` use the same commits as
  [ci.yml](../.github/workflows/ci.yml); Renovate keeps all of them current.
- **No untrusted text in scripts.** The tag name reaches the scripts only through environment variables,
  never pasted into the script itself, so a strange tag name can't become a command.
- **No stored credentials.** Checkout doesn't keep its token (`persist-credentials: false`), and the
  workflow uses no secrets: only the short-lived token GitHub gives each run.
- **No shared cache.** The build turns off setup-node's npm cache (`package-manager-cache: false`),
  because a release build shouldn't reuse a cache that other workflow runs can write to; `npm ci`
  downloads every package fresh and checks it against `package-lock.json`.
- **Only release versions.** Tags must look like `v1.2.3`, and a tag that doesn't match `package.json`
  stops the build before anything is published.

```yaml
name: Release

on:
  push:
    tags:
      - "v[0-9]+.[0-9]+.[0-9]+"

permissions: {}

jobs:
  build:
    name: Build the Windows installer
    runs-on: windows-latest
    permissions:
      contents: read
      id-token: write
      attestations: write
    outputs:
      version: ${{ steps.version.outputs.version }}
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7
        with:
          fetch-depth: 0
          persist-credentials: false

      - uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7
        with:
          node-version: 24
          package-manager-cache: false

      - name: Install dependencies
        run: npm ci

      - name: Lint, format, typecheck, tests with coverage, public-repo check
        run: npm run verify

      - name: Check that the tag matches the version in package.json
        id: version
        shell: pwsh
        env:
          TAG: ${{ github.ref_name }}
        run: |
          $version = (Get-Content -LiteralPath package.json -Raw | ConvertFrom-Json).version
          if ($version -cnotmatch '^[0-9]+\.[0-9]+\.[0-9]+$') {
            throw "The version in package.json ('$version') isn't of the form 1.2.3."
          }
          if ($env:TAG -cne "v$version") {
            throw "The tag '$env:TAG' doesn't match the version in package.json ('v$version')."
          }
          "version=$version" >> $env:GITHUB_OUTPUT

      - name: Build the installer
        run: npm run dist

      - name: Write SHA256SUMS.txt
        shell: pwsh
        env:
          VERSION: ${{ steps.version.outputs.version }}
        run: |
          $name = "Sage-Setup-$env:VERSION.exe"
          $found = @(Get-ChildItem -LiteralPath out -File | Where-Object { $_.Name -like 'Sage-Setup-*.exe' })
          if ($found.Count -ne 1 -or $found[0].Name -cne $name) {
            throw "Expected exactly one installer, out/$name; found: $($found.Name -join ', ')"
          }
          $hash = (Get-FileHash -LiteralPath $found[0].FullName -Algorithm SHA256).Hash.ToLowerInvariant()
          [System.IO.File]::WriteAllText((Join-Path $PWD 'out/SHA256SUMS.txt'), "$hash  $name`n")
          Get-Content -LiteralPath out/SHA256SUMS.txt

      - name: Make the build provenance for the installer
        id: attest
        uses: actions/attest@1e69f48acb82d1966a394da916b4c1698aa569d6 # v4.2.2
        with:
          subject-path: out/Sage-Setup-${{ steps.version.outputs.version }}.exe

      - name: Copy the provenance next to the installer
        shell: pwsh
        env:
          BUNDLE: ${{ steps.attest.outputs.bundle-path }}
          VERSION: ${{ steps.version.outputs.version }}
        run: Copy-Item -LiteralPath $env:BUNDLE -Destination "out/Sage-Setup-$env:VERSION.sigstore.json"

      - name: Keep the three release files for the release job
        uses: actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9 # v7.0.2
        with:
          name: release-files
          path: |
            out/Sage-Setup-${{ steps.version.outputs.version }}.exe
            out/SHA256SUMS.txt
            out/Sage-Setup-${{ steps.version.outputs.version }}.sigstore.json
          if-no-files-found: error
          retention-days: 7

  release:
    name: Publish the GitHub release
    needs: build
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - name: Get the three release files
        uses: actions/download-artifact@9000827ccba6bdab643e8b6fd33ac0654aef8333 # v8.0.2
        with:
          name: release-files
          path: release-files

      - name: Publish the release with exactly those files
        env:
          GH_TOKEN: ${{ github.token }}
          GH_REPO: ${{ github.repository }}
          TAG: ${{ github.ref_name }}
          VERSION: ${{ needs.build.outputs.version }}
        run: |
          files=(
            "release-files/Sage-Setup-$VERSION.exe"
            "release-files/SHA256SUMS.txt"
            "release-files/Sage-Setup-$VERSION.sigstore.json"
          )
          if assets=$(gh release view "$TAG" --json assets --jq '.assets | length' 2>/dev/null); then
            # The tag was made on the Releases page, which made the release too: add the files to it,
            # but only if it has none yet.
            if [ "$assets" != "0" ]; then
              echo "The release $TAG already has files. Remove them on the Releases page, then re-run this job." >&2
              exit 1
            fi
            gh release upload "$TAG" "${files[@]}"
          else
            gh release create "$TAG" "${files[@]}" --verify-tag --title "Sage $VERSION" \
              --notes "What changed is in CHANGELOG.md. Before you run the installer, check it as docs/installing.md explains."
          fi
```

Notes on the workflow:

- `actions/attest` with only `subject-path` makes a build provenance (SLSA) record. Its README also lists
  `artifact-metadata: write`, which it needs only for "storage records"; those are made only when
  `push-to-registry` is on, for container images, so the permission is left out.
- The checksum file names only the installer. The provenance file is checked with `gh attestation verify`
  instead (below).
- The workflow can't be tried before it is added; the first tagged release is its first real run. If it
  fails, nothing is published: fix the workflow in a pull request, delete the tag (and an empty release,
  if the Releases page made one), and tag again.

## Making a release, step by step

1. **Pick the version.** Releases follow [Semantic Versioning](https://semver.org/): `1.2.3` means
   major.minor.patch. A fix only is a patch (`0.1.1`), new features are a minor version (`0.2.0`).
2. **Open a release pull request** from a new branch:
   - set the version in `package.json` and `package-lock.json` together with
     `npm version 0.2.0 --no-git-tag-version`;
   - in `CHANGELOG.md`, rename `## [Unreleased]` to `## [0.2.0] - 2026-12-01` (the version and today's
     date) and add a new, empty `## [Unreleased]` above it;
   - commit with `git commit -s`, push the branch and open the pull request. Merge it once every check
     passes.
3. **Optionally try the installer first** on a Windows PC: `npm run dist` on the merged `main`, install
   `out/Sage-Setup-0.2.0.exe` and run the "Installed app" section of the
   [Windows checklist](windows-checklist.md).
4. **Create and push the tag** on the merged commit, either way:
   - **with git**, from an up-to-date `main`:

     ```sh
     git switch main
     git pull
     git tag -a v0.2.0 -m "Sage 0.2.0"
     git push origin v0.2.0
     ```

   - **on GitHub**: on the Releases page choose **Draft a new release**, type `v0.2.0` under **Choose a
     tag** and pick **Create new tag: v0.2.0 on publish**, keep the target `main`, set the title
     `Sage 0.2.0`, attach no files, and choose **Publish release**. The workflow adds the three files to
     that release a few minutes later.
5. **Watch the run** under **Actions → Release**. When it is green, the release has the installer,
   `SHA256SUMS.txt` and the provenance file, and the attestation is listed under the repository's
   **Attestations**. Download the installer and check it as below.

## Checking a downloaded installer

Download the installer and `SHA256SUMS.txt` from the same release into one folder (usually Downloads).

**The checksum**, in PowerShell, in that folder (put in the version you downloaded):

```powershell
cd $HOME\Downloads
Get-FileHash .\Sage-Setup-0.2.0.exe -Algorithm SHA256
Get-Content .\SHA256SUMS.txt
```

The long `Hash` value must be the same as the one in `SHA256SUMS.txt` (capital or small letters don't
matter). Or let PowerShell compare them; it prints `True` when they match:

```powershell
(Get-FileHash .\Sage-Setup-0.2.0.exe -Algorithm SHA256).Hash -eq (-split (Get-Content .\SHA256SUMS.txt))[0]
```

If they don't match, don't run the installer: download it again, and report it if it still differs.

**The provenance** shows that the installer was built by this repository's release workflow on GitHub,
not on someone's PC. It needs the [GitHub CLI](https://cli.github.com/), signed in with `gh auth login`:

```powershell
gh attestation verify .\Sage-Setup-0.2.0.exe --repo HoneyBearTech/sage-assistant --signer-workflow HoneyBearTech/sage-assistant/.github/workflows/release.yml
```

It ends with a line saying the verification succeeded, and names the workflow and commit that built the
file. To check against the provenance file from the release instead of GitHub's attestations list, add
`--bundle .\Sage-Setup-0.2.0.sigstore.json`.
