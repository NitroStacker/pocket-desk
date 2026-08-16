using System.Runtime.InteropServices;

namespace PocketDesk.SecureHost;

internal static class Program
{
    private const int ErrorFailedServiceControllerConnect = 1063;

    public static async Task<int> Main(string[] args)
    {
        if (!OperatingSystem.IsWindows())
        {
            Console.Error.WriteLine("PocketDesk Secure Host supports Windows only.");
            return 1;
        }

        try
        {
            if (args.Contains("--write-config", StringComparer.OrdinalIgnoreCase))
            {
                string json = await Console.In.ReadToEndAsync();
                MachineConfig.SaveFromJson(json);
                Console.WriteLine(MachineConfig.ConfigPath);
                return 0;
            }

            if (args.Contains("--check-config", StringComparer.OrdinalIgnoreCase))
            {
                MachineConfig config = MachineConfig.Load();
                Console.WriteLine($"Secure host enrollment is valid for {new Uri(config.RelayUrl).Host}.");
                return 0;
            }

            if (args.Contains("--probe", StringComparer.OrdinalIgnoreCase))
            {
                uint sessionId = NativeMethods.WTSGetActiveConsoleSessionId();
                Console.WriteLine(DesktopEnvironment.ProbeJson(sessionId));
                return 0;
            }

            if (args.Contains("--worker", StringComparer.OrdinalIgnoreCase))
            {
                uint sessionId = ParseSessionId(args);
                await SecureWorker.RunAsync(sessionId);
                return 0;
            }

            if (!WindowsService.Run())
            {
                int error = Marshal.GetLastWin32Error();
                if (error == ErrorFailedServiceControllerConnect)
                {
                    Console.Error.WriteLine("Run this executable through the PocketDesk Windows service installer, or use --probe.");
                }
                else
                {
                    Console.Error.WriteLine($"The Windows service dispatcher could not start ({error}).");
                }
                return 1;
            }
            return 0;
        }
        catch (Exception exception)
        {
            AppLog.Error(exception.ToString());
            Console.Error.WriteLine(exception.Message);
            return 1;
        }
    }

    private static uint ParseSessionId(string[] args)
    {
        int index = Array.FindIndex(args, value => value.Equals("--session", StringComparison.OrdinalIgnoreCase));
        if (index < 0 || index + 1 >= args.Length || !uint.TryParse(args[index + 1], out uint sessionId))
        {
            throw new ArgumentException("The secure worker requires --session <id>.");
        }
        return sessionId;
    }
}
