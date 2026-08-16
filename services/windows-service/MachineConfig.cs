using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Security.Principal;

namespace PocketDesk.SecureHost;

internal sealed record MachineConfig(string RelayUrl, string SessionId, string HostToken)
{
    private const uint CryptProtectLocalMachine = 0x4;
    private static readonly Regex TokenPattern = new("^[a-f0-9]{64}$", RegexOptions.Compiled | RegexOptions.CultureInvariant);

    public static string ConfigPath => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
        "PocketDesk",
        "secure-host.dpapi");

    public static void SaveFromJson(string json)
    {
        using WindowsIdentity identity = WindowsIdentity.GetCurrent();
        WindowsPrincipal principal = new(identity);
        SecurityIdentifier localSystem = new(WellKnownSidType.LocalSystemSid, null);
        if (!(identity.User?.Equals(localSystem) ?? false) && !principal.IsInRole(WindowsBuiltInRole.Administrator))
        {
            throw new UnauthorizedAccessException("Writing the machine enrollment requires Administrator or LocalSystem.");
        }
        MachineConfig config = Parse(json);
        byte[] plain = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(config));
        byte[] protectedBytes = Protect(plain);
        string directory = Path.GetDirectoryName(ConfigPath)!;
        string temporary = $"{ConfigPath}.{Environment.ProcessId}.tmp";
        Directory.CreateDirectory(directory);
        File.WriteAllBytes(temporary, protectedBytes);
        File.Move(temporary, ConfigPath, true);
    }

    public static MachineConfig Load()
    {
        byte[] protectedBytes = File.ReadAllBytes(ConfigPath);
        byte[] plain = Unprotect(protectedBytes);
        try
        {
            return Parse(Encoding.UTF8.GetString(plain));
        }
        finally
        {
            Array.Clear(plain);
        }
    }

    private static MachineConfig Parse(string json)
    {
        MachineConfig? config = JsonSerializer.Deserialize<MachineConfig>(json, new JsonSerializerOptions
        {
            PropertyNameCaseInsensitive = true,
        });
        if (config is null ||
            !Uri.TryCreate(config.RelayUrl.TrimEnd('/'), UriKind.Absolute, out Uri? relay) ||
            relay.Scheme != Uri.UriSchemeHttps ||
            !Guid.TryParse(config.SessionId, out _) ||
            !TokenPattern.IsMatch(config.HostToken))
        {
            throw new InvalidDataException("The machine secure-host enrollment is invalid.");
        }
        return config with { RelayUrl = config.RelayUrl.TrimEnd('/') };
    }

    private static byte[] Protect(byte[] value)
    {
        NativeMethods.DATA_BLOB input = NativeMethods.DATA_BLOB.FromBytes(value);
        try
        {
            if (!NativeMethods.CryptProtectData(
                ref input,
                "PocketDesk secure host enrollment",
                IntPtr.Zero,
                IntPtr.Zero,
                IntPtr.Zero,
                CryptProtectLocalMachine,
                out NativeMethods.DATA_BLOB output))
            {
                throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
            }
            try
            {
                return output.ToBytes();
            }
            finally
            {
                NativeMethods.LocalFree(output.pbData);
            }
        }
        finally
        {
            input.Free();
        }
    }

    private static byte[] Unprotect(byte[] value)
    {
        NativeMethods.DATA_BLOB input = NativeMethods.DATA_BLOB.FromBytes(value);
        try
        {
            if (!NativeMethods.CryptUnprotectData(
                ref input,
                IntPtr.Zero,
                IntPtr.Zero,
                IntPtr.Zero,
                IntPtr.Zero,
                0,
                out NativeMethods.DATA_BLOB output))
            {
                throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
            }
            try
            {
                return output.ToBytes();
            }
            finally
            {
                NativeMethods.LocalFree(output.pbData);
            }
        }
        finally
        {
            input.Free();
        }
    }
}
