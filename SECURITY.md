# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.x | Yes |
| Older | No |

## Reporting a Vulnerability

Report vulnerabilities privately through GitHub's "Report a vulnerability" button on this repo's Security tab. Don't open public issues, discussions, or pull requests for security problems.

Include:
- The affected version or commit
- Steps to reproduce
- The security impact and how an attacker could use it
- A proof of concept or minimal example, if you have one (remove credentials, tokens, and personal data)

I'll acknowledge reports within 48 hours and keep you updated until a fix ships. Fixes are released as patch versions and announced in GitHub releases.

## Scope

Beep Me is self-hosted. Each deployment holds its owner's channel keys (Twilio, Telnyx, Resend, Gmail, SMTP, Telegram, Slack, Discord, ntfy, Pushover, webhooks), agent tokens, and OAuth grants. Reports about these are in scope:

- Reading or using another account's channel keys, agent tokens, OAuth grants, or messages
- Sending a notification without a valid agent token or OAuth grant
- Getting past an agent's highest priority, channel list, text cap, message cap, or revocation
- Forging Telegram webhook calls or SMS delivery receipts
- Cross-site request forgery or script injection in the dashboard, the approval page, or the docs site

How Beep Me stores keys and checks requests: [Security](https://github.com/yannelli/beep-me/blob/main/src/web/docs/content/reference/security.mdx) in the docs.
