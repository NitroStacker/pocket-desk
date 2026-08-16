# PocketDesk architecture

## Components

| Component | Runtime | Responsibility |
| --- | --- | --- |
| Mobile | Expo SDK 54 / React Native 0.81 | Pairing, mobile Start surface, app library, spatial application reflow, visual-region reconstruction, and precision input |
| Host | Node.js plus built-in Windows PowerShell/.NET/WinRT APIs | Screen capture, adaptive JPEG encoding, input injection, deep UI Automation geometry scan, selected-window visual capture, Windows OCR segmentation, icon extraction, Start/taskbar catalog, and Windows file search |
| Secure host | Native .NET 8 Windows service plus per-console-session LocalSystem worker | Boot-time relay connection, Windows sign-in/lock desktop detection, restricted JPEG capture, and direct pointer/Unicode keyboard injection |
| Relay | Cloudflare Worker plus one SQLite-backed Durable Object per session | Session creation, authentication, WebSocket presence, frame/control forwarding |

No direct inbound connection reaches the Windows PC. The host and viewer both initiate outbound connections to the relay.

## Session lifecycle

1. On first enrollment, the host calls `POST /api/sessions` with the relay admin secret and stores its returned credential with Windows DPAPI for the current user.
2. The Worker creates a random session ID, a 256-bit host key, and a 15-minute, one-use device invitation.
3. A phone exchanges the invitation for its own 256-bit trusted-device key. The invitation hash is deleted atomically, and only the device-key hash is retained.
4. The PC can create more named invitations, list trusted devices, and revoke any individual device through host-authenticated relay APIs.
5. The signed-in host, secure worker, and phones authenticate during the WebSocket handshake with subprotocols `host.<key>`, `secure.<host-key>`, or `viewer.<device-key>` plus `pocketdesk-v1`.
6. The Durable Object records the trusted device ID on the hibernating socket and forwards only role-appropriate message types. When the secure worker reports an actual sign-in/locked Winlogon desktop, it becomes the sole screen/input target and the regular host capture pauses. Revocation closes matching active sockets.
7. Host and trusted phones reconnect without a session timer. The phone keeps its key in SecureStore (iOS Keychain/Android Keystore); removing a device deletes its relay-side hash.

## Data plane

Host to phone:

- Binary WebSocket messages are complete JPEG frames.
- `desktop-meta` describes capture dimensions, quality, profile, and machine name.
- `semantic-snapshot` contains open windows plus each selected-app element's hierarchy, role, state, original order, bounds, desktop target coordinate, and exposed value.
- `shell-snapshot` contains a sanitized Start menu and pinned-taskbar catalog. Shortcut target paths remain on the host.
- `shell-results` contains app matches and sanitized file metadata with opaque item IDs.
- `shell-launched` confirms an allowlisted app or file was handed to Windows.
- `app-icon` returns one bounded PNG data URI for a previously issued app or open-window icon key.
- `app-visual` returns one bounded JPEG of a previously issued, non-protected open window. The phone crops this source into reordered visual regions rather than presenting a tiny desktop viewport.
- `pong`, `host-status`, and relay presence drive connection UI.

Phone to host:

- `input` contains one validated, allowlisted mouse, keyboard, window-focus, or text action.
- `request-semantic` asks for a fresh active-window scan.
- `request-shell` asks for the current Start/taskbar catalog.
- `search-shell` searches the catalog and Windows Search index using a bounded query.
- `launch-shell` may reference only an opaque ID previously issued by the host; the host never accepts a raw command or path.
- `request-icons` requests bounded icon keys from the current catalog/window snapshot. The phone cannot submit an executable path.
- `request-app-visual` requests a bounded visual only for an exact process/window-handle pair already issued in the current open-window snapshot.
- `set-quality` changes among fixed, bounded capture profiles.
- `set-stream` suspends desktop frame capture and delivery unless the full-screen Desktop surface is visible.
- `ping` measures the round trip through the real host.

The relay does not interpret frame bytes. It validates JSON message type allowlists and drops viewer binary messages.

## Windows sign-in handoff

The Service Control Manager starts `PocketDeskSecureHost` as LocalSystem before user login. The service duplicates only its own SYSTEM token, assigns it to the active physical-console session, and launches a hidden worker on `winsta0`. A dedicated worker thread opens the current input desktop and attaches with `SetThreadDesktop`; it never exposes an inbound PC port.

The worker activates only when the input desktop is `Winlogon` and the console session is signed out or observed transitioning from its calibrated unlocked state. This distinction deliberately excludes UAC shown over an unlocked session. While active, the relay accepts only JPEG frames, `desktop-meta`, `secure-status`, `pong`, and errors from the secure role; viewer traffic is limited to validated pointer/key/text input, an explicit Windows secure-attention request, stream settings, quality, and ping. Shell, file, semantic, app, clipboard, and camera messages never reach the SYSTEM worker. Unlocking changes `secure-status`, resumes the regular host capture, and restores the mobile workspace automatically.

## Latency behavior

JPEG frames are already compressed, so per-message WebSocket compression is disabled. The host sends a frame only while a viewer is present and the socket has less than 1.5 MB buffered. When the network slows, new frames are dropped; the app therefore remains close to live instead of replaying stale frames.

The available capture profiles are:

| Profile | Width cap | JPEG quality | Target FPS | Use |
| --- | ---: | ---: | ---: | --- |
| Smooth | 960 | 44 | 5 | Cellular data and interaction |
| Balanced | 1280 | 56 | 4 | Default productivity use |
| Sharp | 1600 | 68 | 3 | Reading text and static screens |

## Mobile reshaping

PocketDesk uses four interpretation layers, with interface reconstruction as the primary interface:

1. A Raw UI Automation traversal extracts open windows, hierarchy, geometry, fields, values, actions, menus, tabs, options, and readable document content.
2. The phone reconstructs the app by spatial role: tab and menu rows remain app chrome, toolbar controls stay together, side navigation becomes a narrow-screen strip, editors and content become the main surface, and status data remains at the bottom. It does not regroup elements into invented generic control sections.
3. When the accessibility tree is sparse, Windows OCR is used only to find coherent visual regions. The host sends a bounded JPEG of the selected window and the phone stacks touchable crops of the real interface. Raw OCR fragments are not displayed as controls.
4. The full-screen live desktop remains the precision compatibility layer.

The full-screen Desktop surface defaults to relative trackpad control and also offers direct touch. Its gesture state machine waits for a clear movement threshold before locking every two-finger contact to one intent until both fingers lift. Trackpad mode chooses remote scrolling or local pinch zoom; touch mode chooses local viewport panning or pinch zoom. Pinching holds the original centroid fixed, while panning holds scale fixed, so contact jitter cannot apply both transforms at once. This also prevents partial finger lifts from alternately scaling, panning, clicking, and dragging. Trackpad taps, two-finger right-clicks, and double-tap drags are translated into bounded allowlisted input commands; the regular and secure Windows input paths implement the same button-down/button-up lifecycle.

The Home view is a phone-native Windows Start surface. Its Apps toolbar opens a library that combines live windows, pinned taskbar apps, traditional Start menu shortcuts, and packaged Windows apps. Packaged apps are launched by validated App User Model IDs and use icons extracted from their signed package manifests. The host enumerates real top-level Win32 windows instead of relying on `Process.MainWindowHandle`; this is required for File Explorer, legacy packaged-app frames, and multiple windows owned by one process. Selecting an app reuses its only open window or presents a per-window chooser when several are open; Windows receives a new launch only when no matching window exists. Selecting or closing a window uses its validated process/window-handle pair, and closing posts a normal `WM_CLOSE` so the application retains control of unsaved-work prompts. A selected handle also pins semantic scans, visual capture, and subsequent mobile input so another foreground window cannot replace the chosen interface.

The mobile client selects a renderer from a shared adapter registry. File Explorer, Bezi, Chrome, ChatGPT/Codex, Windows Settings, Notepad/document apps, and Camera each have layouts built from their actual accessibility controls and current window geometry. Camera and visual-heavy surfaces also use authenticated per-window visual capture; Camera refreshes its preview independently while its shutter and adjustment controls remain semantic. The Windows host keeps a dedicated, serialized DirectShow `IAMCameraControl` bridge alive for low-latency standard-UVC pan, tilt, and zoom. Camera commands are allow-listed and range-clamped, and the three user-saved PTZ presets persist under the current Windows user's local application data. Other applications use the universal semantic reflow and visual-region fallback. Activating any reconstructed control or visual region operates the corresponding element on the real desktop and requests a fresh reflow. Protected credential, lock, consent, and shell helper surfaces remain excluded.

Window selection is revisioned. If an Explorer scan is already running when the viewer selects Bezi, the host discards the completed Explorer result instead of publishing stale UI. Start/taskbar launches also retain a local shortcut-to-process identity, allowing a single-instance app such as Bezi to select its existing window even when Windows leaves the previously focused app in the foreground.
