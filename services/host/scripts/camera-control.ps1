param(
    [ValidateSet('Query', 'Move', 'Set', 'Home', 'Indicator')]
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
    [switch]$IndicatorEnabled,
    [switch]$Server
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using Microsoft.Win32.SafeHandles;

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
        public IndicatorReport indicator { get; set; }
        public bool moved { get; set; }
        public string error { get; set; }
        public PtzReport() {
            device = "";
            action = "";
            pan = new AxisReport();
            tilt = new AxisReport();
            zoom = new AxisReport();
            indicator = new IndicatorReport();
            error = "";
        }
    }

    public sealed class IndicatorReport {
        public bool supported { get; set; }
        public bool enabled { get; set; }
        public bool applied { get; set; }
        public string error { get; set; }
        public IndicatorReport() { error = ""; }
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

    public static class IndicatorBridge {
        const uint CrSuccess = 0;
        const uint PresentInterfaces = 0;
        const uint GenericRead = 0x80000000;
        const uint GenericWrite = 0x40000000;
        const uint ShareRead = 0x00000001;
        const uint ShareWrite = 0x00000002;
        const uint OpenExisting = 3;
        const ushort VendorId = 0x328f;
        const ushort ProductId = 0x00c0;
        const ushort PixyUsage = 0x0083;
        const int ReportLength = 32;
        const int IndicatorCommandLength = ReportLength * 2;

        [StructLayout(LayoutKind.Sequential)]
        struct HidAttributes {
            public int Size;
            public ushort VendorID;
            public ushort ProductID;
            public ushort VersionNumber;
        }

        [StructLayout(LayoutKind.Sequential)]
        struct HidCaps {
            public ushort Usage;
            public ushort UsagePage;
            public ushort InputReportByteLength;
            public ushort OutputReportByteLength;
            public ushort FeatureReportByteLength;
            [MarshalAs(UnmanagedType.ByValArray, SizeConst = 17)]
            public ushort[] Reserved;
            public ushort NumberLinkCollectionNodes;
            public ushort NumberInputButtonCaps;
            public ushort NumberInputValueCaps;
            public ushort NumberInputDataIndices;
            public ushort NumberOutputButtonCaps;
            public ushort NumberOutputValueCaps;
            public ushort NumberOutputDataIndices;
            public ushort NumberFeatureButtonCaps;
            public ushort NumberFeatureValueCaps;
            public ushort NumberFeatureDataIndices;
        }

        [DllImport("hid.dll")]
        static extern void HidD_GetHidGuid(out Guid hidGuid);

        [DllImport("hid.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        static extern bool HidD_GetAttributes(SafeFileHandle device, ref HidAttributes attributes);

        [DllImport("hid.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        static extern bool HidD_GetPreparsedData(SafeFileHandle device, out IntPtr preparsedData);

        [DllImport("hid.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        static extern bool HidD_FreePreparsedData(IntPtr preparsedData);

        [DllImport("hid.dll")]
        static extern int HidP_GetCaps(IntPtr preparsedData, ref HidCaps capabilities);

        [DllImport("cfgmgr32.dll", CharSet = CharSet.Unicode)]
        static extern uint CM_Get_Device_Interface_List_SizeW(
            out uint length,
            ref Guid interfaceClassGuid,
            string deviceId,
            uint flags
        );

        [DllImport("cfgmgr32.dll", CharSet = CharSet.Unicode)]
        static extern uint CM_Get_Device_Interface_ListW(
            ref Guid interfaceClassGuid,
            string deviceId,
            [Out] char[] buffer,
            uint bufferLength,
            uint flags
        );

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        static extern SafeFileHandle CreateFile(
            string fileName,
            uint desiredAccess,
            uint shareMode,
            IntPtr securityAttributes,
            uint creationDisposition,
            uint flagsAndAttributes,
            IntPtr templateFile
        );

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        static extern bool WriteFile(
            SafeFileHandle file,
            byte[] buffer,
            uint bytesToWrite,
            out uint bytesWritten,
            IntPtr overlapped
        );

        public static IndicatorReport Apply(byte[] report) {
            var result = new IndicatorReport();
            if (!IsAllowedReport(report)) {
                result.error = "The indicator command did not match PocketDesk's fixed PIXY report.";
                return result;
            }
            result.enabled = report[9] == 1 && report[10] == 1 && report[11] == 1;

            try {
                foreach (string path in PresentHidInterfaces()) {
                    using (var handle = CreateFile(
                        path,
                        GenericRead | GenericWrite,
                        ShareRead | ShareWrite,
                        IntPtr.Zero,
                        OpenExisting,
                        0,
                        IntPtr.Zero
                    )) {
                        if (handle == null || handle.IsInvalid) continue;
                        var attributes = new HidAttributes { Size = Marshal.SizeOf(typeof(HidAttributes)) };
                        if (!HidD_GetAttributes(handle, ref attributes)) continue;
                        if (attributes.VendorID != VendorId || attributes.ProductID != ProductId) continue;

                        result.supported = true;
                        IntPtr preparsedData;
                        if (!HidD_GetPreparsedData(handle, out preparsedData)) {
                            result.error = "Windows could not inspect the PIXY indicator interface.";
                            return result;
                        }
                        try {
                            var caps = new HidCaps { Reserved = new ushort[17] };
                            if (HidP_GetCaps(preparsedData, ref caps) < 0 ||
                                caps.UsagePage != PixyUsage || caps.Usage != PixyUsage ||
                                caps.OutputReportByteLength != ReportLength) {
                                result.supported = false;
                                result.error = "The connected EMEET device did not expose PIXY's indicator interface.";
                                continue;
                            }
                        } finally {
                            HidD_FreePreparsedData(preparsedData);
                        }

                        for (int offset = 0; offset < IndicatorCommandLength; offset += ReportLength) {
                            var command = new byte[ReportLength];
                            Array.Copy(report, offset, command, 0, ReportLength);
                            uint written;
                            if (!WriteFile(handle, command, ReportLength, out written, IntPtr.Zero) || written != ReportLength) {
                                result.error = "Windows could not apply the PIXY indicator setting.";
                                return result;
                            }
                        }
                        result.applied = true;
                        result.error = "";
                        return result;
                    }
                }
                result.error = "EMEET PIXY is not connected to Windows.";
                return result;
            } catch (Exception error) {
                result.error = error.Message;
                return result;
            }
        }

        static bool IsAllowedReport(byte[] report) {
            if (report == null || report.Length != IndicatorCommandLength) return false;
            byte[] switchPrefix = { 0x09, 0x02, 0x02, 0x00, 0x00, 0x04, 0x00, 0x04, 0x00 };
            for (int i = 0; i < switchPrefix.Length; i++) if (report[i] != switchPrefix[i]) return false;
            bool allOff = report[9] == 0 && report[10] == 0 && report[11] == 0;
            bool allOn = report[9] == 1 && report[10] == 1 && report[11] == 1;
            if (!allOff && !allOn) return false;
            for (int i = 12; i < ReportLength; i++) if (report[i] != 0) return false;

            int brightnessOffset = ReportLength;
            byte[] brightnessPrefix = { 0x09, 0x02, 0x02, 0x04, 0x00, 0x02, 0x00, 0x02, 0x00 };
            for (int i = 0; i < brightnessPrefix.Length; i++) {
                if (report[brightnessOffset + i] != brightnessPrefix[i]) return false;
            }
            byte brightness = report[brightnessOffset + 9];
            if ((allOff && brightness != 0) || (allOn && brightness != 100)) return false;
            for (int i = brightnessOffset + 10; i < report.Length; i++) if (report[i] != 0) return false;
            return true;
        }

        static IEnumerable<string> PresentHidInterfaces() {
            Guid hidGuid;
            HidD_GetHidGuid(out hidGuid);
            for (int attempt = 0; attempt < 3; attempt++) {
                uint length;
                uint result = CM_Get_Device_Interface_List_SizeW(out length, ref hidGuid, null, PresentInterfaces);
                if (result != CrSuccess) throw new IOException("Windows could not enumerate HID interfaces.");
                var buffer = new char[Math.Max(2, (int)length)];
                result = CM_Get_Device_Interface_ListW(ref hidGuid, null, buffer, (uint)buffer.Length, PresentInterfaces);
                if (result != CrSuccess) continue;
                return new string(buffer).Split(new[] { '\0' }, StringSplitOptions.RemoveEmptyEntries);
            }
            throw new IOException("The Windows HID interface list changed while it was being read.");
        }
    }
}
'@

function New-IndicatorReport([bool]$Enabled) {
    [byte[]]$report = New-Object byte[] 64
    [byte[]]$switchPrefix = @(0x09, 0x02, 0x02, 0x00, 0x00, 0x04, 0x00, 0x04, 0x00)
    [Array]::Copy($switchPrefix, 0, $report, 0, $switchPrefix.Length)
    [byte]$switch = if ($Enabled) { 1 } else { 0 }
    $report[9] = $switch
    $report[10] = $switch
    $report[11] = $switch
    [byte[]]$brightnessPrefix = @(0x09, 0x02, 0x02, 0x04, 0x00, 0x02, 0x00, 0x02, 0x00)
    [Array]::Copy($brightnessPrefix, 0, $report, 32, $brightnessPrefix.Length)
    $report[41] = if ($Enabled) { 100 } else { 0 }
    return $report
}

function Invoke-CameraCommand(
    [string]$CommandAction,
    [string]$CommandDirection,
    [int]$CommandAmount,
    [int]$CommandPan,
    [int]$CommandTilt,
    [int]$CommandZoom
) {
    $response = if ($CommandAction -eq 'Indicator') {
        New-Object PocketDesk.CameraControl.PtzReport
    } else {
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
    # PIXY firmware 2.x does not advertise indicator control and ignores the
    # generic EMEET RGB/brightness commands. Do not report a successful USB
    # write as a physical light change, and do not keep sending ignored packets.
    $response.indicator = New-Object PocketDesk.CameraControl.IndicatorReport
    $response.indicator.supported = $false
    $response.indicator.enabled = $true
    $response.indicator.applied = $false
    $response.indicator.error = 'This PIXY firmware controls the green active-camera light internally and does not expose an Off control.'
    return $response
}

if ($Server) {
    while ($null -ne ($requestLine = [Console]::In.ReadLine())) {
        try {
            $request = $requestLine | ConvertFrom-Json
            $requestAction = if (@('Query', 'Move', 'Set', 'Home', 'Indicator') -contains [string]$request.action) { [string]$request.action } else { 'Query' }
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
