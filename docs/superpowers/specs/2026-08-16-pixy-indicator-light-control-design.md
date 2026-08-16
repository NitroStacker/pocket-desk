# EMEET PIXY Indicator Light Control Design

Date: 2026-08-16
Status: Approved design, pending written-spec review

## Summary

PocketDesk will add a persistent Indicator light control to the Camera application for the connected EMEET PIXY. The desired light state defaults to Off, is stored by the Windows host, and is reapplied after host restarts and camera reconnections.

Indicator control must be independent of the PIXY operating mode. A user who chooses Off must be able to use the live preview, pan, tilt, zoom, Normal/Idle mode, Tracking mode, and any other active camera mode without the light turning back on. Privacy Mode is not an acceptable substitute because it points the camera downward and interrupts normal camera use.

The device does not expose indicator control through standard UVC camera properties. Its official manual describes the indicator as mode-driven, and the public reverse-engineered HID commands currently cover tracking, privacy, gesture, and audio modes but do not document an independent light command. Implementation therefore begins with a hardware capability gate. PocketDesk will expose the toggle only after an exact, independently verified vendor HID command has been identified and validated on the connected device.

## Goals

- Add an Indicator light On/Off switch to the PocketDesk Camera motor panel.
- Default the desired setting to Off on first use.
- Keep the light off independently in every active camera mode.
- Preserve the setting across host restarts, app restarts, and USB disconnect/reconnect cycles.
- Allow the user to turn the indicator back on.
- Report honest supported, pending, applied, and error states to the mobile UI.
- Keep live preview and existing PTZ controls operational if indicator control is unavailable or fails.

## Non-goals

- Do not map Indicator Off to Privacy Mode.
- Do not disable the camera stream, microphone, tracking, gestures, or PTZ to make the light turn off.
- Do not accept arbitrary HID bytes from the mobile client or relay.
- Do not support unrelated camera models in this change.
- Do not brute-force undocumented device commands; unknown commands may enter upgrade, calibration, or other unsafe firmware paths.
- Do not automate the EMEET STUDIO user interface as a runtime dependency.

## Hardware Facts and Capability Gate

The connected camera identifies as EMEET PIXY with USB vendor/product ID `328F:00C0`. Windows exposes its normal UVC camera controls and a separate vendor HID interface with usage page `0x83`, usage `0x83`, and 32-byte input/output reports.

Before product code is written, the implementation phase must establish all of the following:

1. The firmware has an indicator command that is independent of Normal/Idle, Tracking, and Privacy modes.
2. The exact 32-byte set and query/acknowledgement reports are understood; no byte positions are guessed.
3. Turning the light off does not stop or alter the live video stream, PTZ, focus, microphone, tracking, or gestures.
4. The light remains controllable after switching between every supported active mode.
5. The command works on this device's current firmware and can be safely limited to the exact PIXY USB/HID identity.

Discovery may use non-destructive static analysis of the official companion software, controlled USB captures of an official light setting if one exists, and read-only HID queries. It must not scan or write unknown command ranges.

If these conditions cannot be proven, the feature is considered hardware-blocked. PocketDesk will not add a switch that merely changes saved state without controlling the physical light.

## Architecture

### Vendor HID bridge

Vendor-specific HID behavior will live in a narrowly scoped Windows helper, separate from the standard DirectShow/UVC PTZ implementation. The helper will:

- Enumerate HID interfaces and select only `VID_328F`, `PID_00C0`, usage page `0x83`, usage `0x83`, with 32-byte reports.
- Construct only the verified Indicator Get and Indicator Set reports internally.
- Accept typed operations such as `QueryIndicator` and `SetIndicator`; callers cannot supply raw report bytes.
- Require an expected acknowledgement or readback within a bounded timeout.
- Return a structured result containing support, applied state, action, and a sanitized error.
- Serialize access so writes and acknowledgements cannot cross between operations.

The existing TypeScript `CameraController` remains the single coordination point for Camera status. It will serialize indicator and PTZ jobs through its existing operation queue while keeping failures isolated: a HID failure must not stop the DirectShow PTZ bridge.

### Persistent policy

The Windows host will store a camera settings record under the existing PocketDesk local application-data directory. Its only new preference is:

```json
{
  "indicatorDesiredOn": false
}
```

Missing or corrupt settings use Off, per the approved product default. A successful user change is persisted before reconciliation is scheduled, so the desired choice survives a host interruption.

The host reconciles desired and device state:

- at host/camera-controller startup;
- when the camera is first detected;
- after USB reconnection;
- after any PocketDesk-issued camera mode change;
- after a device mode-change event, when the HID interface reports one;
- during a low-rate status reconciliation while a viewer is using the Camera application, only if the firmware resets indicator state during mode changes and does not emit a usable event.

Reconciliation does not continuously rewrite a confirmed state. It writes only when state is unknown or differs from the persisted preference.

### Protocol and state model

The existing relay message types remain unchanged. The mobile client sends a new validated Camera command:

```ts
{ kind: "indicatorSet", on: boolean }
```

The relay continues to forward the already allow-listed `camera-control` envelope. The Windows host is the trust boundary that validates the command and maps it to the fixed HID operation.

Camera status gains an indicator object:

```ts
interface CameraIndicatorStatus {
  supported: boolean;
  desiredOn: boolean;
  appliedOn: boolean | null;
  pending: boolean;
  error: string;
}
```

`appliedOn` is null until the device acknowledges the operation or a readback confirms state. The UI must not present a physical Off state based only on the saved preference. Older hosts that omit the indicator object remain compatible: the mobile parser treats the field as unavailable rather than rejecting the whole Camera status message.

## Mode Independence

Indicator state and camera mode are separate axes:

| Camera mode | Desired indicator Off | Desired indicator On |
| --- | --- | --- |
| Normal/Idle | Light remains off; preview and PTZ work | Firmware's normal indicator behavior |
| Tracking | Light remains off; tracking and PTZ work | Firmware's tracking indicator behavior |
| Other active modes supported by the device | Light remains off without disabling the mode | Firmware's mode-specific indicator behavior |
| Privacy | Privacy behavior remains owned by the camera mode | Privacy behavior remains owned by the camera mode |

Switching modes must not change `indicatorDesiredOn`. If a mode transition resets the physical light, PocketDesk marks applied state unknown and immediately reconciles it back to the persisted preference.

## Mobile UI

The Camera motor panel will add one compact row near the device Ready badge and PTZ readout:

- Label: `Indicator light`
- Control: accessible On/Off switch
- Initial desired position: Off
- Pending copy: `Applying...`
- Unsupported copy: `Indicator control is not supported by this PIXY firmware.`
- Failure copy: a concise retryable error without disabling PTZ

The switch uses `accessibilityRole="switch"`, reports its checked state, and has a touch target consistent with the rest of the Camera controls. While an operation is pending, repeat taps are disabled. If the operation fails, the desired state remains saved, the applied state becomes unknown, and a Retry action triggers reconciliation.

## Error Handling

- Camera absent: retain desired Off, report unavailable, and retry after detection.
- HID interface absent or wrong shape: report unsupported; do not open another HID device.
- Permission/open failure: report a sanitized retryable error; keep PTZ and preview available.
- Timeout or malformed acknowledgement: close/reopen the HID handle, mark applied state unknown, and retry only through bounded reconciliation.
- Device reset or unplug during a command: fail the pending operation, retain preference, and reconcile after reconnect.
- Unsupported firmware: disable the switch and explain the limitation; do not use Privacy Mode as a fallback.
- Settings-file corruption: fall back to desired Off and replace the file after the next successful preference write.

## Security and Safety

- The remote protocol exposes a boolean, never raw HID data.
- The host allow-lists the new command shape and rejects extra or invalid values.
- The native bridge checks the exact USB identity, HID usage, and report lengths before any write.
- Report construction is fixed in trusted host code and covered by byte-for-byte tests.
- Errors returned remotely are length-limited and do not expose device paths or arbitrary native exceptions.
- Discovery and production code avoid firmware-update, calibration, and unknown command groups.

## Testing

### Automated tests

- Accept `{ kind: "indicatorSet", on: true | false }`; reject missing, non-boolean, or unknown indicator commands.
- Verify first-run and corrupt-file behavior default to desired Off.
- Verify preference persistence for both Off and On.
- Verify exact HID device matching and byte-for-byte report construction using captured fixtures.
- Verify acknowledgement parsing, timeouts, malformed responses, disconnects, and unsupported-device results.
- Verify reconciliation writes only when required and reapplies after reconnect and mode transition.
- Verify HID failures do not change PTZ status or terminate the existing motor process.
- Verify mobile Camera-status parsing remains compatible with old hosts and validates the new indicator object.
- Verify switch disabled, pending, applied, unsupported, and retry states.
- Run all host, relay, mobile typecheck, and existing regression suites.

### Hardware acceptance tests

On the connected EMEET PIXY:

1. Start with no settings file; confirm the host turns the indicator off.
2. Keep Windows Camera preview active; confirm video, microphone, pan, tilt, and zoom still work with the light off.
3. Enter Tracking mode; confirm tracking works and the light remains off.
4. Return to Normal/Idle mode; confirm the light remains off.
5. Exercise every other active mode exposed by the firmware; confirm the light remains off.
6. Turn the switch On; confirm the camera resumes its normal mode-specific indicator colors.
7. Turn it Off again, unplug/replug the camera, and confirm Off is reapplied.
8. Restart the PocketDesk host and confirm Off is reapplied.
9. Trigger an HID failure and confirm live preview and PTZ remain usable.

## Acceptance Criteria

- Off is the first-run desired default.
- A confirmed Off state physically extinguishes the indicator while live video remains active.
- Off remains effective in Normal/Idle, Tracking, and every other active camera mode.
- Mode transitions do not change the saved preference and are reconciled when needed.
- On restores the PIXY's native mode-specific light behavior.
- The preference survives app, host, and USB reconnect cycles.
- The mobile UI never reports applied Off without hardware acknowledgement or readback.
- Unsupported firmware produces an honest disabled state, not a simulated success.
- Existing camera preview, shutter, PTZ, presets, relay security, and non-camera applications do not regress.

## References

- EMEET PIXY / PIXY 2K user manual: <https://cdn.shopify.com/s/files/1/0594/9472/7851/files/emeet_pixy_2k_4k_uesr_manual.pdf?v=1778810703>
- EMEET PIXY product support: <https://emeet.com/en-ae/pages/emeet-pixy-support>
- Public PIXY HID reverse-engineering reference: <https://gist.github.com/rm1138/ef132c3a39f3c1effabf6354e2eca965>
- Public PIXY HID implementation: <https://github.com/LarsArtmann/emeet-pixyd>
