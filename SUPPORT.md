# Support

Sage is maintained by one person in their own time (see [GOVERNANCE.md](GOVERNANCE.md)), so this is a
best-effort policy, not a contract.

## Getting help

- **Setting it up**: the [README](README.md) and [docs/installing.md](docs/installing.md) cover the Windows
  installer, running from source on Windows and Linux, installing the local model runner and a model,
  and the online brain. The most common
  problem is "Sage can't reach the local model runner": start Ollama (or open its app) and try again.
- **Questions, bugs and ideas**: [GitHub Issues](https://github.com/HoneyBearTech/sage-assistant/issues).
  Say which release (or commit) you run, your operating system, which brain you use, and what you
  expected. **Never paste your online service key**, and redact it from logs and screenshots.
- **Security vulnerabilities**: never in a public issue; see [SECURITY.md](SECURITY.md).

Problems with Ollama, a model, or an online model service themselves belong with those projects; this
one can only help with how Sage talks to them.

## Which versions are supported

Releases follow [Semantic Versioning](https://semver.org/) (`major.minor.patch`) and are published, with
the Windows installer, on the [Releases page](https://github.com/HoneyBearTech/sage-assistant/releases).
Only the latest release is supported: a fix comes in a new release, not as a patch to an older one.

| Version | Supported with | Until |
| --- | --- | --- |
| The latest release | bug fixes and security fixes, in the next release | the next release comes out |
| The latest commit on `main` | bug fixes and security fixes | always (fixes land there first) |
| Older releases and older commits | nothing | the next release or commit landed |

To update the installed app, run the newer installer; your data stays (see
[docs/installing.md](docs/installing.md#installing-on-windows)).
