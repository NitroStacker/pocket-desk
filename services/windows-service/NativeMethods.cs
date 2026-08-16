using System.Runtime.InteropServices;
using System.Text;

namespace PocketDesk.SecureHost;

internal static class NativeMethods
{
    internal const uint InvalidSessionId = 0xFFFFFFFF;
    internal const uint MaximumAllowed = 0x02000000;
    internal const int UoiName = 2;

    internal const uint ServiceWin32OwnProcess = 0x10;
    internal const uint ServiceStartPending = 0x2;
    internal const uint ServiceStopPending = 0x3;
    internal const uint ServiceRunning = 0x4;
    internal const uint ServiceStopped = 0x1;
    internal const uint ServiceAcceptStop = 0x1;
    internal const uint ServiceAcceptShutdown = 0x4;
    internal const uint ServiceAcceptSessionChange = 0x80;
    internal const uint ServiceControlStop = 0x1;
    internal const uint ServiceControlShutdown = 0x5;
    internal const uint ServiceControlSessionChange = 0xE;

    internal const uint TokenAssignPrimary = 0x0001;
    internal const uint TokenDuplicate = 0x0002;
    internal const uint TokenQuery = 0x0008;
    internal const uint TokenAdjustDefault = 0x0080;
    internal const uint TokenAdjustSessionId = 0x0100;
    internal const int SecurityImpersonation = 2;
    internal const int TokenPrimary = 1;
    internal const int TokenSessionId = 12;
    internal const uint CreateUnicodeEnvironment = 0x00000400;
    internal const uint CreateNoWindow = 0x08000000;

    internal const uint InputMouse = 0;
    internal const uint InputKeyboard = 1;
    internal const uint KeyEventKeyUp = 0x0002;
    internal const uint KeyEventUnicode = 0x0004;
    internal const uint MouseEventLeftDown = 0x0002;
    internal const uint MouseEventLeftUp = 0x0004;
    internal const uint MouseEventRightDown = 0x0008;
    internal const uint MouseEventRightUp = 0x0010;
    internal const uint MouseEventWheel = 0x0800;

    internal const int SmXVirtualScreen = 76;
    internal const int SmYVirtualScreen = 77;
    internal const int SmCxVirtualScreen = 78;
    internal const int SmCyVirtualScreen = 79;

    [UnmanagedFunctionPointer(CallingConvention.Winapi)]
    internal delegate void ServiceMainDelegate(uint argumentCount, IntPtr arguments);

    [UnmanagedFunctionPointer(CallingConvention.Winapi)]
    internal delegate uint ServiceControlHandlerDelegate(
        uint control,
        uint eventType,
        IntPtr eventData,
        IntPtr context);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    internal struct SERVICE_TABLE_ENTRY
    {
        [MarshalAs(UnmanagedType.LPWStr)]
        internal string? serviceName;
        internal ServiceMainDelegate? serviceMain;
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct SERVICE_STATUS
    {
        internal uint serviceType;
        internal uint currentState;
        internal uint controlsAccepted;
        internal uint win32ExitCode;
        internal uint serviceSpecificExitCode;
        internal uint checkPoint;
        internal uint waitHint;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    internal struct STARTUPINFO
    {
        internal uint cb;
        internal string? reserved;
        internal string? desktop;
        internal string? title;
        internal uint x;
        internal uint y;
        internal uint xSize;
        internal uint ySize;
        internal uint xCountChars;
        internal uint yCountChars;
        internal uint fillAttribute;
        internal uint flags;
        internal ushort showWindow;
        internal ushort reserved2;
        internal IntPtr reserved2Pointer;
        internal IntPtr standardInput;
        internal IntPtr standardOutput;
        internal IntPtr standardError;
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct PROCESS_INFORMATION
    {
        internal IntPtr process;
        internal IntPtr thread;
        internal uint processId;
        internal uint threadId;
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct POINT
    {
        internal int x;
        internal int y;
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct INPUT
    {
        internal uint type;
        internal INPUT_UNION data;
    }

    [StructLayout(LayoutKind.Explicit)]
    internal struct INPUT_UNION
    {
        [FieldOffset(0)] internal MOUSEINPUT mouse;
        [FieldOffset(0)] internal KEYBDINPUT keyboard;
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct MOUSEINPUT
    {
        internal int dx;
        internal int dy;
        internal uint mouseData;
        internal uint flags;
        internal uint time;
        internal UIntPtr extraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct KEYBDINPUT
    {
        internal ushort virtualKey;
        internal ushort scanCode;
        internal uint flags;
        internal uint time;
        internal UIntPtr extraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct DATA_BLOB
    {
        internal int cbData;
        internal IntPtr pbData;

        internal static DATA_BLOB FromBytes(byte[] bytes)
        {
            IntPtr pointer = Marshal.AllocHGlobal(bytes.Length);
            Marshal.Copy(bytes, 0, pointer, bytes.Length);
            return new DATA_BLOB { cbData = bytes.Length, pbData = pointer };
        }

        internal readonly byte[] ToBytes()
        {
            byte[] bytes = new byte[cbData];
            Marshal.Copy(pbData, bytes, 0, cbData);
            return bytes;
        }

        internal void Free()
        {
            if (pbData == IntPtr.Zero) return;
            Marshal.FreeHGlobal(pbData);
            pbData = IntPtr.Zero;
            cbData = 0;
        }
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    internal struct WTSINFOEX_LEVEL1
    {
        internal uint sessionId;
        internal int sessionState;
        internal int sessionFlags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 33)] internal string winStationName;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 21)] internal string userName;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 18)] internal string domainName;
        internal long logonTime;
        internal long connectTime;
        internal long disconnectTime;
        internal long lastInputTime;
        internal long currentTime;
        internal uint incomingBytes;
        internal uint outgoingBytes;
        internal uint incomingFrames;
        internal uint outgoingFrames;
        internal uint incomingCompressedBytes;
        internal uint outgoingCompressedBytes;
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct WTSINFOEX
    {
        internal uint level;
        internal WTSINFOEX_LEVEL1 level1;
    }

    [DllImport("advapi32.dll", EntryPoint = "StartServiceCtrlDispatcherW", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool StartServiceCtrlDispatcher(SERVICE_TABLE_ENTRY[] serviceTable);

    [DllImport("advapi32.dll", EntryPoint = "RegisterServiceCtrlHandlerExW", CharSet = CharSet.Unicode, SetLastError = true)]
    internal static extern IntPtr RegisterServiceCtrlHandlerEx(
        string serviceName,
        ServiceControlHandlerDelegate handler,
        IntPtr context);

    [DllImport("advapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool SetServiceStatus(IntPtr serviceStatusHandle, ref SERVICE_STATUS serviceStatus);

    [DllImport("kernel32.dll")]
    internal static extern uint WTSGetActiveConsoleSessionId();

    [DllImport("kernel32.dll")]
    internal static extern IntPtr GetCurrentProcess();

    [DllImport("kernel32.dll")]
    internal static extern uint GetCurrentThreadId();

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool CloseHandle(IntPtr handle);

    [DllImport("advapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool OpenProcessToken(IntPtr process, uint desiredAccess, out IntPtr token);

    [DllImport("advapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool DuplicateTokenEx(
        IntPtr existingToken,
        uint desiredAccess,
        IntPtr tokenAttributes,
        int impersonationLevel,
        int tokenType,
        out IntPtr newToken);

    [DllImport("advapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool SetTokenInformation(
        IntPtr token,
        int tokenInformationClass,
        ref uint tokenInformation,
        uint tokenInformationLength);

    [DllImport("userenv.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool CreateEnvironmentBlock(out IntPtr environment, IntPtr token, bool inherit);

    [DllImport("userenv.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool DestroyEnvironmentBlock(IntPtr environment);

    [DllImport("advapi32.dll", EntryPoint = "CreateProcessAsUserW", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool CreateProcessAsUser(
        IntPtr token,
        string? applicationName,
        StringBuilder commandLine,
        IntPtr processAttributes,
        IntPtr threadAttributes,
        bool inheritHandles,
        uint creationFlags,
        IntPtr environment,
        string currentDirectory,
        ref STARTUPINFO startupInfo,
        out PROCESS_INFORMATION processInformation);

    [DllImport("user32.dll", SetLastError = true)]
    internal static extern IntPtr OpenInputDesktop(uint flags, bool inherit, uint desiredAccess);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool CloseDesktop(IntPtr desktop);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool SetThreadDesktop(IntPtr desktop);

    [DllImport("user32.dll")]
    internal static extern IntPtr GetThreadDesktop(uint threadId);

    [DllImport("user32.dll", EntryPoint = "GetUserObjectInformationW", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool GetUserObjectInformation(
        IntPtr objectHandle,
        int index,
        StringBuilder? information,
        uint length,
        out uint needed);

    [DllImport("user32.dll")]
    internal static extern int GetSystemMetrics(int index);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool SetCursorPos(int x, int y);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool GetCursorPos(out POINT point);

    [DllImport("user32.dll")]
    internal static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extraInfo);

    [DllImport("user32.dll", SetLastError = true)]
    internal static extern uint SendInput(uint inputCount, INPUT[] inputs, int inputSize);

    [DllImport("sas.dll")]
    internal static extern void SendSAS([MarshalAs(UnmanagedType.Bool)] bool asUser);

    [DllImport("wtsapi32.dll", EntryPoint = "WTSQuerySessionInformationW", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool WTSQuerySessionInformation(
        IntPtr server,
        uint sessionId,
        int infoClass,
        out IntPtr buffer,
        out uint bytesReturned);

    [DllImport("wtsapi32.dll")]
    internal static extern void WTSFreeMemory(IntPtr memory);

    [DllImport("crypt32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool CryptProtectData(
        ref DATA_BLOB dataIn,
        string description,
        IntPtr optionalEntropy,
        IntPtr reserved,
        IntPtr prompt,
        uint flags,
        out DATA_BLOB dataOut);

    [DllImport("crypt32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool CryptUnprotectData(
        ref DATA_BLOB dataIn,
        IntPtr description,
        IntPtr optionalEntropy,
        IntPtr reserved,
        IntPtr prompt,
        uint flags,
        out DATA_BLOB dataOut);

    [DllImport("kernel32.dll")]
    internal static extern IntPtr LocalFree(IntPtr memory);
}
