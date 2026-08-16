param(
    [ValidateSet('Query', 'Move', 'Set', 'Home')]
    [string]$Action = 'Query',
    [ValidateSet('', 'Left', 'Right', 'Up', 'Down', 'ZoomIn', 'ZoomOut')]
    [string]$Direction = '',
    [ValidateRange(1, 20)]
    [int]$Amount = 1,
    [int]$Pan = [int]::MinValue,
    [int]$Tilt = [int]::MinValue,
    [int]$Zoom = [int]::MinValue,
    [ValidateLength(1, 120)]
    [string]$DeviceName = 'EMEET PIXY',
    [switch]$Server
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;

namespace PocketDesk.CameraControl {
    [ComImport, Guid("29840822-5B84-11D0-BD3B-00A0C911CE86"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface ICreateDevEnum {
        [PreserveSig]
        int CreateClassEnumerator([In] ref Guid type, out IEnumMoniker moniker, int flags);
    }

    [ComImport, Guid("55272A00-42CB-11CE-8135-00AA004BB851"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IPropertyBag {
        [PreserveSig]
        int Read([MarshalAs(UnmanagedType.LPWStr)] string name, [MarshalAs(UnmanagedType.Struct)] out object value, IntPtr errorLog);
        [PreserveSig]
        int Write([MarshalAs(UnmanagedType.LPWStr)] string name, [In, MarshalAs(UnmanagedType.Struct)] ref object value);
    }

    enum CameraProperty {
        Pan = 0,
        Tilt = 1,
        Roll = 2,
        Zoom = 3,
        Exposure = 4,
        Iris = 5,
        Focus = 6
    }

    [Flags]
    enum CameraFlags {
        Auto = 0x1,
        Manual = 0x2
    }

    [ComImport, Guid("C6E13370-30AC-11D0-A18C-00A0C9118956"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAMCameraControl {
        [PreserveSig]
        int GetRange(CameraProperty property, out int minimum, out int maximum, out int step, out int defaultValue, out CameraFlags capabilities);
        [PreserveSig]
        int Set(CameraProperty property, int value, CameraFlags flags);
        [PreserveSig]
        int Get(CameraProperty property, out int value, out CameraFlags flags);
    }

    public sealed class AxisReport {
        public bool supported { get; set; }
        public int minimum { get; set; }
        public int maximum { get; set; }
        public int step { get; set; }
        public int defaultValue { get; set; }
        public int current { get; set; }
        public int flags { get; set; }
    }

    public sealed class PtzReport {
        public string device { get; set; }
        public string action { get; set; }
        public AxisReport pan { get; set; }
        public AxisReport tilt { get; set; }
        public AxisReport zoom { get; set; }
        public bool moved { get; set; }
        public string error { get; set; }
        public PtzReport() {
            device = "";
            action = "";
            pan = new AxisReport();
            tilt = new AxisReport();
            zoom = new AxisReport();
            error = "";
        }
    }

    public static class PtzBridge {
        static readonly Guid VideoInputCategory = new Guid("860BB310-5D01-11D0-BD3B-00A0C911CE86");
        static readonly Guid BaseFilter = new Guid("56A86895-0AD4-11CE-B03A-0020AF0BA770");
        static readonly Guid PropertyBag = new Guid("55272A00-42CB-11CE-8135-00AA004BB851");
        static readonly Guid SystemDeviceEnumerator = new Guid("62BE5D10-60EB-11D0-BD3B-00A0C911CE86");

        public static PtzReport Execute(string deviceName, string action, string direction, int amount, int requestedPan, int requestedTilt, int requestedZoom) {
            var report = new PtzReport { action = action };
            object enumeratorObject = null;
            IEnumMoniker monikers = null;
            IMoniker selectedMoniker = null;
            object filterObject = null;
            try {
                var type = Type.GetTypeFromCLSID(SystemDeviceEnumerator, true);
                enumeratorObject = Activator.CreateInstance(type);
                var enumerator = (ICreateDevEnum)enumeratorObject;
                var category = VideoInputCategory;
                int enumResult = enumerator.CreateClassEnumerator(ref category, out monikers, 0);
                if (enumResult != 0 || monikers == null) {
                    report.error = "Windows did not report any video input devices.";
                    return report;
                }

                var candidates = new List<string>();
                var fetched = new IMoniker[1];
                while (monikers.Next(1, fetched, IntPtr.Zero) == 0) {
                    var moniker = fetched[0];
                    string friendlyName = ReadFriendlyName(moniker);
                    candidates.Add(friendlyName);
                    if (selectedMoniker == null && friendlyName.IndexOf(deviceName, StringComparison.OrdinalIgnoreCase) >= 0) {
                        selectedMoniker = moniker;
                        report.device = friendlyName;
                        break;
                    } else {
                        Marshal.ReleaseComObject(moniker);
                    }
                }

                if (selectedMoniker == null) {
                    report.error = "The requested camera was not found. Available: " + string.Join(", ", candidates.ToArray());
                    return report;
                }

                var filterId = BaseFilter;
                selectedMoniker.BindToObject(null, null, ref filterId, out filterObject);
                var control = filterObject as IAMCameraControl;
                if (control == null) {
                    report.error = "This camera does not expose the standard Windows camera-control interface.";
                    return report;
                }

                report.pan = ReadAxis(control, CameraProperty.Pan);
                report.tilt = ReadAxis(control, CameraProperty.Tilt);
                report.zoom = ReadAxis(control, CameraProperty.Zoom);

                if (string.Equals(action, "Move", StringComparison.OrdinalIgnoreCase)) {
                    report.moved = Move(control, report, direction, Math.Max(1, amount));
                } else if (string.Equals(action, "Home", StringComparison.OrdinalIgnoreCase)) {
                    bool panSet = !report.pan.supported || SetAxis(control, CameraProperty.Pan, report.pan, report.pan.defaultValue);
                    bool tiltSet = !report.tilt.supported || SetAxis(control, CameraProperty.Tilt, report.tilt, report.tilt.defaultValue);
                    bool zoomSet = !report.zoom.supported || SetAxis(control, CameraProperty.Zoom, report.zoom, report.zoom.defaultValue);
                    report.moved = panSet && tiltSet && zoomSet;
                } else if (string.Equals(action, "Set", StringComparison.OrdinalIgnoreCase)) {
                    bool changed = false;
                    bool succeeded = true;
                    if (requestedPan != int.MinValue) { changed = true; succeeded &= SetAxis(control, CameraProperty.Pan, report.pan, requestedPan); }
                    if (requestedTilt != int.MinValue) { changed = true; succeeded &= SetAxis(control, CameraProperty.Tilt, report.tilt, requestedTilt); }
                    if (requestedZoom != int.MinValue) { changed = true; succeeded &= SetAxis(control, CameraProperty.Zoom, report.zoom, requestedZoom); }
                    report.moved = changed && succeeded;
                }

                report.pan = ReadAxis(control, CameraProperty.Pan);
                report.tilt = ReadAxis(control, CameraProperty.Tilt);
                report.zoom = ReadAxis(control, CameraProperty.Zoom);
                return report;
            } catch (Exception error) {
                report.error = error.Message;
                return report;
            } finally {
                Release(filterObject);
                Release(selectedMoniker);
                Release(monikers);
                Release(enumeratorObject);
            }
        }

        static bool Move(IAMCameraControl control, PtzReport report, string direction, int amount) {
            if (string.Equals(direction, "Left", StringComparison.OrdinalIgnoreCase)) return SetAxis(control, CameraProperty.Pan, report.pan, report.pan.current - EffectiveStep(report.pan) * amount);
            if (string.Equals(direction, "Right", StringComparison.OrdinalIgnoreCase)) return SetAxis(control, CameraProperty.Pan, report.pan, report.pan.current + EffectiveStep(report.pan) * amount);
            if (string.Equals(direction, "Up", StringComparison.OrdinalIgnoreCase)) return SetAxis(control, CameraProperty.Tilt, report.tilt, report.tilt.current + EffectiveStep(report.tilt) * amount);
            if (string.Equals(direction, "Down", StringComparison.OrdinalIgnoreCase)) return SetAxis(control, CameraProperty.Tilt, report.tilt, report.tilt.current - EffectiveStep(report.tilt) * amount);
            if (string.Equals(direction, "ZoomIn", StringComparison.OrdinalIgnoreCase)) return SetAxis(control, CameraProperty.Zoom, report.zoom, report.zoom.current + EffectiveStep(report.zoom) * amount);
            if (string.Equals(direction, "ZoomOut", StringComparison.OrdinalIgnoreCase)) return SetAxis(control, CameraProperty.Zoom, report.zoom, report.zoom.current - EffectiveStep(report.zoom) * amount);
            report.error = "Unknown camera movement.";
            return false;
        }

        static AxisReport ReadAxis(IAMCameraControl control, CameraProperty property) {
            var axis = new AxisReport();
            CameraFlags rangeFlags;
            int minimum;
            int maximum;
            int step;
            int defaultValue;
            int result = control.GetRange(property, out minimum, out maximum, out step, out defaultValue, out rangeFlags);
            if (result < 0) return axis;
            axis.supported = true;
            axis.minimum = minimum;
            axis.maximum = maximum;
            axis.step = Math.Max(1, Math.Abs(step));
            axis.defaultValue = defaultValue;
            axis.flags = (int)rangeFlags;
            CameraFlags currentFlags;
            int current;
            if (control.Get(property, out current, out currentFlags) >= 0) {
                axis.current = current;
                axis.flags = (int)currentFlags;
            } else axis.current = defaultValue;
            return axis;
        }

        static bool SetAxis(IAMCameraControl control, CameraProperty property, AxisReport axis, int requested) {
            if (!axis.supported) return false;
            int clamped = Math.Max(axis.minimum, Math.Min(axis.maximum, requested));
            int step = EffectiveStep(axis);
            int snapped = axis.minimum + (int)Math.Round((clamped - axis.minimum) / (double)step) * step;
            snapped = Math.Max(axis.minimum, Math.Min(axis.maximum, snapped));
            return control.Set(property, snapped, CameraFlags.Manual) >= 0;
        }

        static int EffectiveStep(AxisReport axis) { return Math.Max(1, axis.step); }

        static string ReadFriendlyName(IMoniker moniker) {
            object bagObject = null;
            try {
                var propertyBagId = PropertyBag;
                moniker.BindToStorage(null, null, ref propertyBagId, out bagObject);
                var bag = (IPropertyBag)bagObject;
                object value;
                if (bag.Read("FriendlyName", out value, IntPtr.Zero) >= 0 && value != null) return value.ToString();
                return "Camera";
            } finally { Release(bagObject); }
        }

        static void Release(object value) {
            // This bridge is intentionally a short-lived helper process. Some USB
            // camera drivers aggregate the moniker, property bag, and filter into
            // one RCW; releasing any one early invalidates the others. Process exit
            // safely releases the graph after the single requested operation.
        }
    }
}
'@

function Invoke-CameraCommand(
    [string]$CommandAction,
    [string]$CommandDirection,
    [int]$CommandAmount,
    [int]$CommandPan,
    [int]$CommandTilt,
    [int]$CommandZoom
) {
    [PocketDesk.CameraControl.PtzBridge]::Execute(
        $DeviceName,
        $CommandAction,
        $CommandDirection,
        $CommandAmount,
        $CommandPan,
        $CommandTilt,
        $CommandZoom
    )
}

if ($Server) {
    while ($null -ne ($requestLine = [Console]::In.ReadLine())) {
        try {
            $request = $requestLine | ConvertFrom-Json
            $requestAction = if (@('Query', 'Move', 'Set', 'Home') -contains [string]$request.action) { [string]$request.action } else { 'Query' }
            $requestDirection = if (@('', 'Left', 'Right', 'Up', 'Down', 'ZoomIn', 'ZoomOut') -contains [string]$request.direction) { [string]$request.direction } else { '' }
            $requestAmount = [Math]::Max(1, [Math]::Min(20, [int]$request.amount))
            $requestPan = if ($null -ne $request.pan) { [int]$request.pan } else { [int]::MinValue }
            $requestTilt = if ($null -ne $request.tilt) { [int]$request.tilt } else { [int]::MinValue }
            $requestZoom = if ($null -ne $request.zoom) { [int]$request.zoom } else { [int]::MinValue }
            $response = Invoke-CameraCommand $requestAction $requestDirection $requestAmount $requestPan $requestTilt $requestZoom
            [Console]::Out.WriteLine(($response | ConvertTo-Json -Depth 5 -Compress))
            [Console]::Out.Flush()
        }
        catch {
            [Console]::Out.WriteLine((@{ device = $DeviceName; action = 'Error'; moved = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress))
            [Console]::Out.Flush()
        }
    }
    exit 0
}

$report = Invoke-CameraCommand $Action $Direction $Amount $Pan $Tilt $Zoom
$report | ConvertTo-Json -Depth 5 -Compress
