# PocketDesk security notes

PocketDesk controls the currently logged-in Windows session. Treat the host process, relay admin token, and pairing code as highly sensitive.

## Current protections

- The PC has no listening port; it initiates an outbound TLS WebSocket.
- Session, host, and viewer identifiers use Web Crypto randomness rather than predictable values.
- The relay stores only SHA-256 token hashes and compares secrets with Cloudflare's timing-safe API.
- Host and viewer credentials are separate, high entropy, and expire after at most 24 hours.
- Every session gets a separate Durable Object coordination boundary.
- The Worker accepts only an explicit protocol message allowlist for each role.
- The host validates and bounds every desktop input message. App/file launch requests can use only opaque IDs from the host's current Start-menu catalog or latest search result; there is no shell-command or raw-path input type.
- Icon requests use only app IDs or process IDs already present in the authenticated session's latest snapshots. Window focus and visual requests must match an enumerated process/window-handle pair. Executable and shortcut paths never leave the host.
- OCR runs locally on Windows and is used only to segment opaque interfaces. Temporary OCR screenshots are deleted immediately. When the authorized phone requests an opaque app, the host may relay one aggressively size-bounded JPEG of that selected, previously enumerated window so the phone can crop and reflow the actual interface.
- UAC, credential pickers, Windows Security, the lock screen, and related protected helper processes are excluded from semantic scans, visual capture, and the open-app library.
- Secrets are not part of the Worker config or source and local secret files are ignored by Git.

## Trust model and known gaps

- Transport is encrypted with TLS/WSS, but the stream is not end-to-end encrypted above Cloudflare. Cloudflare's edge can technically observe frames and control messages.
- The pairing code is a bearer credential. Anyone who obtains it before expiry can connect as a viewer, and the MVP permits more than one viewer.
- There is no account identity, device enrollment, biometric confirmation, host-side approval prompt, or persistent revocation list yet.
- The admin secret can create sessions. Use a unique random value, store it in a password manager, and rotate it immediately if exposed.
- Text entry stages text in the Windows clipboard and invokes paste. This changes the desktop clipboard and can interact with Windows clipboard history.
- The host runs with the privileges of the user who launched it. It intentionally cannot cross the Windows secure desktop boundary used by UAC and the lock screen.
- Session rows are logically expired but are not yet physically deleted by an alarm. They contain hashes, not usable raw credentials.

## Safe MVP usage

- Start the host only when you intend to connect and stop it when finished.
- Keep expiry short and do not share the pairing code through an untrusted channel.
- Do not run the host as Administrator unless a specific test requires it.
- Use Cloudflare account MFA and keep the `ADMIN_TOKEN` out of shell history, screenshots, logs, and source control.
- Review the viewer count printed by the host and disconnect if it is unexpected.

## Before unattended or production use

Add end-to-end authenticated encryption, per-device enrollment, a visible host approval/revocation UI, single-viewer policy, connection rate limits, session cleanup alarms, signed updates, Windows code signing, protected local secret storage, security-event audit logs, dependency scanning, and an external penetration test.
