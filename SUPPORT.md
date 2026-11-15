# Support

Sage is maintained by one person in their own time (see [GOVERNANCE.md](GOVERNANCE.md)), so this is a
best-effort policy, not a contract.

## Getting help

- **Setting it up**: the [README](README.md) and [docs/installing.md](docs/installing.md) cover running
  from source on Windows and Linux, installing Ollama and a model, and the online brain. The most common
  problem is "Sage can't reach the local model runner": start Ollama (or open its app) and try again.
- **Questions, bugs and ideas**: [GitHub Issues](https://github.com/HoneyBearTech/sage-assistant/issues).
  Say which commit you run, your operating system, which brain you use, and what you expected. **Never
  paste your online service key**, and redact it from logs and screenshots.
- **Security vulnerabilities**: never in a public issue; see [SECURITY.md](SECURITY.md).

Problems with Ollama, a model, or an online model service themselves belong with those projects; this
one can only help with how Sage talks to them.

## Which versions are supported

| Version | Supported with | Until |
| --- | --- | --- |
| The latest commit on `main` | bug fixes and security fixes | always (fixes land there first) |
| Anything older | nothing | it stopped being supported when the next commit landed |

There are no tagged releases yet. When the Windows installer arrives, releases will follow
[Semantic Versioning](https://semver.org/), only the latest release will be supported, and this table will
say so.
