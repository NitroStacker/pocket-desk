using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;

namespace PocketDesk.SecureHost;

internal static class DesktopEnvironment
{
    private const int WtsUserName = 5;
    private const int WtsSessionInfoEx = 25;

    public static string? GetInputDesktopName()
    {
        IntPtr desktop = NativeMethods.OpenInputDesktop(0, false, NativeMethods.MaximumAllowed);
        if (desktop == IntPtr.Zero) return null;
        try
        {
            NativeMethods.GetUserObjectInformation(
                desktop,
                NativeMethods.UoiName,
                null,
                0,
                out uint needed);
            if (needed is 0 or > 512) return null;
            StringBuilder name = new((int)(needed / sizeof(char)) + 1);
            return NativeMethods.GetUserObjectInformation(
                desktop,
                NativeMethods.UoiName,
                name,
                needed,
                out _)
                ? name.ToString()
                : null;
        }
        finally
        {
            NativeMethods.CloseDesktop(desktop);
        }
    }

    public static bool IsWindowsSignInDesktop(
        uint sessionId,
        string? desktopName,
        bool userNameKnown,
        string userName,
        int? unlockedSessionFlag)
    {
        if (!string.Equals(desktopName, "Winlogon", StringComparison.OrdinalIgnoreCase)) return false;
        if (userNameKnown && string.IsNullOrWhiteSpace(userName)) return true;
        return unlockedSessionFlag.HasValue &&
            TryGetSessionFlag(sessionId, out int currentFlag) &&
            currentFlag != unlockedSessionFlag.Value;
    }

    public static bool TryGetSessionUserName(uint sessionId, out string userName) =>
        TryQuerySessionString(sessionId, WtsUserName, out userName);

    public static bool TryGetSessionFlag(uint sessionId, out int sessionFlag)
    {
        sessionFlag = -1;
        if (!NativeMethods.WTSQuerySessionInformation(
            IntPtr.Zero,
            sessionId,
            WtsSessionInfoEx,
            out IntPtr buffer,
            out uint bytes) || buffer == IntPtr.Zero)
        {
            return false;
        }
        try
        {
            if (bytes < Marshal.SizeOf<NativeMethods.WTSINFOEX>()) return false;
            NativeMethods.WTSINFOEX info = Marshal.PtrToStructure<NativeMethods.WTSINFOEX>(buffer);
            if (info.level != 1) return false;
            sessionFlag = info.level1.sessionFlags;
            return sessionFlag is 0 or 1;
        }
        finally
        {
            NativeMethods.WTSFreeMemory(buffer);
        }
    }

    public static IntPtr OpenAndAttach(string expectedName)
    {
        IntPtr desktop = NativeMethods.OpenInputDesktop(0, false, NativeMethods.MaximumAllowed);
        if (desktop == IntPtr.Zero)
        {
            throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error(), "OpenInputDesktop failed");
        }
        string actual = GetDesktopName(desktop);
        if (!actual.Equals(expectedName, StringComparison.OrdinalIgnoreCase))
        {
            NativeMethods.CloseDesktop(desktop);
            throw new InvalidOperationException($"The input desktop changed from {expectedName} to {actual}.");
        }
        if (!NativeMethods.SetThreadDesktop(desktop))
        {
            int error = Marshal.GetLastWin32Error();
            NativeMethods.CloseDesktop(desktop);
            throw new System.ComponentModel.Win32Exception(error, "SetThreadDesktop failed");
        }
        return desktop;
    }

    public static string ProbeJson(uint sessionId)
    {
        string? name = GetInputDesktopName();
        int? sessionFlag = sessionId != NativeMethods.InvalidSessionId && TryGetSessionFlag(sessionId, out int flag)
            ? flag
            : null;
        string userName = "";
        bool userNameKnown = sessionId != NativeMethods.InvalidSessionId && TryGetSessionUserName(sessionId, out userName);
        return JsonSerializer.Serialize(new
        {
            sessionId,
            desktopName = name ?? "unavailable",
            sessionFlag,
            userPresent = !string.IsNullOrWhiteSpace(userName),
            windowsSignIn = sessionId != NativeMethods.InvalidSessionId &&
                IsWindowsSignInDesktop(sessionId, name, userNameKnown, userName, null),
            sourceWidth = NativeMethods.GetSystemMetrics(NativeMethods.SmCxVirtualScreen),
            sourceHeight = NativeMethods.GetSystemMetrics(NativeMethods.SmCyVirtualScreen),
        });
    }

    private static string GetDesktopName(IntPtr desktop)
    {
        NativeMethods.GetUserObjectInformation(desktop, NativeMethods.UoiName, null, 0, out uint needed);
        StringBuilder value = new((int)(needed / sizeof(char)) + 1);
        if (!NativeMethods.GetUserObjectInformation(desktop, NativeMethods.UoiName, value, needed, out _))
        {
            throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        }
        return value.ToString();
    }

    private static bool TryQuerySessionString(uint sessionId, int infoClass, out string value)
    {
        value = "";
        if (!NativeMethods.WTSQuerySessionInformation(
            IntPtr.Zero,
            sessionId,
            infoClass,
            out IntPtr buffer,
            out uint bytes) || buffer == IntPtr.Zero)
        {
            return false;
        }
        try
        {
            value = bytes > sizeof(char) ? Marshal.PtrToStringUni(buffer) ?? "" : "";
            return true;
        }
        finally
        {
            NativeMethods.WTSFreeMemory(buffer);
        }
    }

}
