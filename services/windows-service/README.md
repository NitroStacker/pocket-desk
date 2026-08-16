# PocketDesk Secure Host

This project is the minimal native Windows component that makes PocketDesk available before user login and while the console is locked.

`PocketDeskSecureHost` runs under the Service Control Manager as LocalSystem in Session 0. It launches a second copy of itself into the active physical-console session with a duplicated SYSTEM token. That worker watches the input desktop, attaches a dedicated thread to a signed-out or locked `Winlogon` desktop, and creates the restricted `secure.<host-key>` relay connection.

The secure worker implements only:

- bounded JPEG desktop capture;
- normalized pointer input, a small keyboard/text allowlist, and an explicit Windows `SendSAS` action for PCs whose local policy permits software Ctrl Alt Del;
- Smooth, Balanced, and Sharp settings;
- relay presence, secure-desktop state, and ping.

It does not contain shell execution, file access, UI Automation, app launching, clipboard access, camera control, or device-management APIs. An unlocked UAC prompt is deliberately excluded.

Build and probe the current interactive desktop without installing anything:

```powershell
npm run secure-host:build
dotnet run --project services\windows-service\PocketDesk.SecureHost.csproj -- --probe
```

Install from an elevated PowerShell after the regular host has a persistent enrollment:

```powershell
.\scripts\install-secure-host.ps1
```

The installer publishes self-contained x64 files, copies them under Program Files, writes a machine-DPAPI enrollment under ProgramData with a SYSTEM/Administrators-only ACL, installs automatic service recovery, starts the service, and configures the normal current-user host for post-login handoff.
