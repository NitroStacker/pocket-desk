# PocketDesk

PocketDesk is a mobile-first remote workspace for Windows. Its Current view reconstructs the selected application's real interface as a responsive phone document: original tabs, menus, toolbars, navigation, content, fields, lists, editor, and status areas retain their spatial order while reflowing for a narrow screen. A full-screen live desktop remains available as a precision fallback.

The phone app runs in Expo Go. Both the phone and the Windows host make outbound WebSocket connections to a Cloudflare Worker, so the PC does not need an open inbound port and the phone can connect away from the local Wi-Fi.

## What works

- Full-screen app interfaces rebuilt from Windows UI Automation hierarchy and geometry
- Spatial reflow that preserves the selected app's actual tabs, menus, toolbar, navigation, content, fields, lists, editor, and status area
- Start-menu-style Home screen with pinned taskbar apps and common shortcuts
- Toolbar app library combining live open windows, pinned apps, and Start menu apps
- Real Windows application icons, extracted on demand and cached by the host
- Windows app-and-file search with safe opening through host-issued item IDs
- Open-app switching without finding a desktop taskbar
- Deep Raw UI Automation adaptation for menus, tabs, fields, document text, actions, options, and hierarchy
- Visual-region fallback that uses OCR only for segmentation, then stacks touchable crops of the actual selected window instead of exposing OCR fragments as controls
- Direct phone-native editing of fields and documents, with updates applied to the corresponding desktop element
- Full-screen adaptive JPEG desktop fallback at 3–5 FPS
- Direct touch for pixel-perfect click-and-drag control
- Trackpad, left/right click, scrolling, text paste, and common keyboard shortcuts
- Automatic semantic refresh after interactions and while the mobile workspace is visible
- Top-level Win32 window enumeration and handle-pinned selection, including File Explorer windows that are not exposed through `Process.MainWindowHandle`
- A dedicated File Explorer phone layout with real navigation, address/search fields, commands, tabs, folders, files, and status
- Phone-native file management with thumbnails, copy, move, rename, delete, folder creation, and downloads through the iOS share sheet
- A reusable adapter registry with tailored live layouts for Bezi, Chrome, ChatGPT/Codex, Windows Settings, Notepad and common document apps, and Windows Camera
- Packaged Windows app discovery and real manifest icons, so Camera, Settings, Notepad, and other Microsoft Store apps launch and identify correctly
- A touch-sized Camera interface with authenticated live preview refresh, mode, shutter, focus, brightness, settings, and camera-roll controls
- Direct standard-UVC control for the connected EMEET PIXY motor: precise/large pan and tilt moves, zoom, center/home, live position readouts, and three persistent presets
- Desktop-frame transport is suspended while the semantic workspace is active
- Smooth, Balanced, and Sharp stream profiles
- One-time 256-bit session credentials with a 1–24 hour expiry
- Separate host and viewer keys, stored as SHA-256 hashes in a per-session Durable Object
- Frame backpressure: stale frames are dropped instead of building latency
- Hibernating Cloudflare WebSockets for low idle relay cost

## Architecture

```mermaid
flowchart LR
    H["Windows host<br/>capture + UI Automation + input"] -->|"outbound WSS<br/>host key"| D["Cloudflare Durable Object<br/>one per session"]
    D -->|"outbound WSS<br/>viewer key"| M["Expo Go phone app<br/>Mobile workspace + Desktop fallback + Input"]
    H -. "JPEG frames + semantic metadata" .-> M
    M -. "allowlisted input commands" .-> H
```

Cloudflare is a relay, not a remote browser. The applications continue running normally on the Windows PC. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the protocol and design details.

## Prerequisites

- Windows 10 or 11 for the host
- Node.js 20.19 or newer
- A Cloudflare account for the deployed relay
- Expo Go on the phone (this project deliberately targets Expo SDK 54 for current physical-device compatibility)

## 1. Install

From the repository root:

```powershell
npm install
npm run typecheck
npm test
```

## 2. Deploy the Cloudflare relay

Choose a strong admin token and keep it out of source control. It authorizes session creation.

```powershell
cd services/relay
npx wrangler login
npx wrangler secret put ADMIN_TOKEN
npm run deploy
```

Wrangler prints a URL similar to:

```text
https://pocketdesk-relay.<your-subdomain>.workers.dev
```

For local relay development, copy `.dev.vars.example` to `.dev.vars`, replace its placeholder, and run `npm run dev`. The `.dev.vars` file is ignored by Git.

## 3. Start the Windows host

Use the same admin token configured on the Worker:

```powershell
cd ../..
$env:POCKETDESK_RELAY_URL='https://pocketdesk-relay.<your-subdomain>.workers.dev'
$env:POCKETDESK_ADMIN_TOKEN='<the same strong admin token>'
npm run host
```

The host prints the relay URL, a one-time pairing code, and its expiry. Leave this terminal running while connected. Optional flags are available:

```powershell
npm run host -- --relay https://example.workers.dev --admin '<token>' --expires 8 --profile balanced
```

Profiles are `smooth`, `balanced`, or `sharp` and can also be changed from the phone.

## 4. Run the Expo Go app

For a phone that is not on the development PC's local Wi-Fi, tunnel the Expo development bundle:

```powershell
cd apps/mobile
$env:EXPO_PUBLIC_RELAY_URL='https://pocketdesk-relay.<your-subdomain>.workers.dev'
npx expo start --tunnel
```

Scan Expo's QR code with Expo Go, paste the pairing code shown by the Windows host, and connect. The Expo tunnel serves the development JavaScript bundle; the actual remote-desktop traffic travels through your Cloudflare relay.

## Phone controls

- **Home** — the default phone-sized Windows Start surface. Search apps and files, launch pinned taskbar apps, and jump into open windows.
- **Apps toolbar** — opens a full library of current windows, taskbar pins, and Start menu shortcuts from anywhere in the app.
- **Current** — the selected application's interface itself, reconstructed into a narrow responsive layout. Structured apps receive native tabs, menus, toolbars, editors, fields, lists, and status areas in their original order. Opaque apps receive touchable visual regions cropped from that real window.
- **Desktop** — a full-screen pixel view for canvas-based or otherwise opaque interfaces. Choose Fill or Fit and interact directly by touch.
- **Input** — precision trackpad, mouse buttons, scrolling, text composer, shortcut keys, and stream quality.

## Verification commands

```powershell
npm run typecheck
npm test
npm run relay:types
npm exec --workspace @pocketdesk/relay -- wrangler deploy --dry-run
npm run smoke:capture --workspace @pocketdesk/host
```

The relay integration smoke test expects `wrangler dev` on port 8787:

```powershell
npm run smoke:relay --workspace @pocketdesk/host
```

## Important MVP limits

- This is optimized for administration and productivity, not video playback or gaming. Expo Go does not include a custom native WebRTC stack, so this MVP uses low-latency JPEG frames.
- The Windows lock screen and UAC secure desktop cannot be captured or controlled.
- Secure Windows surfaces such as UAC, credential pickers, and Windows Security are removed from the remote app library because Windows intentionally blocks their accessibility and capture. GPU canvases and unusual custom UI use visual-region reflow; Desktop mode remains available for precision input.
- PC-to-phone downloads are limited to 250 MB per file, and phone-to-PC uploads are not implemented yet. The current host captures the whole Windows virtual desktop. Monitor selection, audio, and clipboard sync are not implemented yet.
- Cloudflare terminates TLS and relays the session; this MVP is not end-to-end encrypted above TLS. Read [docs/SECURITY.md](docs/SECURITY.md) before treating it as unattended or production-ready.

## Natural next milestone

Move the full-screen visual fallback to a signed development build with WebRTC hardware encoding, add device approval and end-to-end session encryption, and run the Windows host as a signed tray application. That gets smooth 30–60 FPS visual fallback without giving up the primary semantic mobile workspace.
