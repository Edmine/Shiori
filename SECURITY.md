# Security Policy

## Reporting a Vulnerability

We take the security of Shiori seriously. If you discover a security vulnerability, please report it responsibly.

### How to Report

**Please do NOT report security vulnerabilities through public GitHub issues.**

Instead, please use GitHub's private vulnerability reporting feature (**Security → Advisories → Report a vulnerability**) on this repository:
https://github.com/Edmine/Shiori/security/advisories/new

Please include:
- A clear description of the vulnerability
- Steps to reproduce the issue
- Potential impact
- Any suggested fixes (optional)

### Scope

This policy applies to:
- The Shiori desktop application (`apps/electron`)
- The Shiori relay worker (`apps/relay`) and workspace packages (`packages/*`)

### Security Best Practices

When using Shiori:

1. **Keep credentials secure**: Never commit `.env` files, API keys, or OAuth tokens.
2. **Review permission modes**: Use Explore or Ask to Edit mode when working in untrusted directories, and use Execute mode with care.
3. **Inspect third-party MCP servers**: Only connect to local stdio or remote MCP servers you trust.
4. **Stay up to date**: Keep your installation updated to the latest release.
