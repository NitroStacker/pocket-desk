# PocketDesk security notes

PocketDesk controls the currently logged-in Windows session. Treat the host process, relay admin token, and pairing code as highly sensitive.

## Current protections

- The PC has no listening port; it initiates an outbound TLS WebSocket.
- Session, host, device, and invitation identifiers use Web Crypto randomness rather than predictable values.
- The relay stores only SHA-256 token hashes. Host and legacy credential comparisons use Cloudflare's timing-safe API; trusted-device lookup hashes the presented high-entropy token before querying.
- Host and phone credentials are separate and high entropy. Each phone receives its own credential, so it can be revoked independently.
- Add-device codes expire after 15 minutes and are deleted atomically after one successful use.
- The host credential is encrypted with Windows DPAPI for the current user. Phone credentials use the iOS Keychain or Android Keystore through Expo SecureStore.
- The optional boot service keeps only relay URL, session ID, and host key in machine-scoped DPAPI storage whose ACL permits SYSTEM and Administrators only. Its installed binaries live under Program Files.
- Every session gets a separate Durable Object coordination boundary.
- The Worker accepts only an explicit protocol message allowlist for each role.
- The secure-host role has a smaller allowlist than the signed-in host. The LocalSystem worker has no shell, file, semantic UI, app-launch, camera, or clipboard implementation.
- The host validates and bounds every desktop input message. Aurora FX input is limited to known zone/effect names, bounded brightness and speed, valid RGB hex colors, and restricted custom-ID syntax before it can cross the app's local named pipe. App/file launch requests can use only opaque IDs from the host's current Start-menu catalog or latest search result; there is no shell-command or raw-path input type.
- PocketDesk does not send status-light HID commands to PIXY firmware 2.x because that model does not advertise or acknowledge independent indicator control. The mobile client receives an explicit unsupported capability instead of a false success response.
- Icon requests use only app IDs or process IDs already present in the authenticated session's latest snapshots. Window focus and visual requests must match an enumerated process/window-handle pair. Executable and shortcut paths never leave the host.
- OCR runs locally on Windows and is used only to segment opaque interfaces. Temporary OCR screenshots are deleted immediately. When the authorized phone requests an opaque app, the host may relay one aggressively size-bounded JPEG of that selected, previously enumerated window so the phone can crop and reflow the actual interface.
- UAC, credential pickers, Windows Security, and related protected helpers are excluded from the signed-in host's semantic scans, visual capture, and app library. The lock/sign-in desktop is available only through the separately allowlisted secure worker.
- Secrets are not part of the Worker config or source and local secret files are ignored by Git.

## Trust model and known gaps

- Transport is encrypted with TLS/WSS, but the stream is not end-to-end encrypted above Cloudflare. Cloudflare's edge can technically observe frames and control messages.
- An unused add-device code is a bearer credential. Anyone who obtains it during its 15-minute lifetime can enroll a device under the invitation's name.
- Trusted-device access persists until the PC removes that device. Protect unlocked phones and periodically review the PC-side device list.
- There is no account identity, biometric confirmation, or OS-native host approval dialog. Approval currently means deliberately creating and transferring a named one-use code on the PC.
- The admin secret can create sessions. Use a unique random value, store it in a password manager, and rotate it immediately if exposed.
- Regular-session text entry stages text in the Windows clipboard and invokes paste. Secure sign-in text uses direct Unicode keyboard injection and never reads or writes the clipboard; the phone masks its password composer.
- The optional sign-in service runs as LocalSystem and can capture/inject input on a signed-out or locked Winlogon desktop. A compromised service binary, machine, relay credential, or already-trusted phone therefore has high impact. The worker checks session lock state so an unlocked user's UAC consent desktop is not made remotely controllable.
- The development service and installer are not code-signed yet. Windows code signing, secured updates, and external review are release blockers.
- Expired invitation rows are cleaned when another invitation is created; a scheduled physical cleanup alarm is not implemented yet. The rows contain hashes, not usable raw credentials.

## Safe MVP usage

- Use host autostart only on a Windows account you intend to make remotely available.
- Install the secure host only on a PC you intend to make remotely sign-in capable, and keep the trusted-device list smaller than for ordinary app access.
- Do not share add-device codes through an untrusted channel. Remove unfamiliar or lost devices immediately with the PC device manager.
- Do not run the host as Administrator unless a specific test requires it.
- Use Cloudflare account MFA and keep the `ADMIN_TOKEN` out of shell history, screenshots, logs, and source control.
- Review the viewer count printed by the host and disconnect if it is unexpected.

## Before unattended or production use

Add end-to-end authenticated encryption, a visible native host approval/revocation UI over the existing device APIs, optional single-viewer policy, connection rate limits, cleanup alarms, signed updates, Windows code signing, security-event audit logs, dependency scanning, and an external penetration test.
