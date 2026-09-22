# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |

## Reporting a Vulnerability

We take the security of Harni seriously. If you discover a security vulnerability, please do NOT create a public GitHub issue.

Instead, please report security issues privately via GitHub Security Advisories or by contacting the maintainers directly.

Please include the following details in your report:
- Description of the vulnerability
- Steps or a minimal reproduction script
- Potential impact and affected components
- Any proposed remediation if available

## Security Architecture & Local Boundaries

- **Local Storage & Credentials**: All sensitive tokens and API keys are encrypted with AES-256-GCM using keys derived via PBKDF2/Scrypt on the local host and stored in `~/.harni/harni.db`.
- **Remote Access Protection**: When exposing the backend over a network (`HOST=0.0.0.0`), configuring `AUTH_TOKEN` is strictly required to prevent unauthorized Remote Code Execution (RCE).
- **Workspace Scoping**: File and command tools operate within the declared workspace boundaries (`resolveSafePath`) to protect host filesystems against path traversal.
