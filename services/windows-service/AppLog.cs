namespace PocketDesk.SecureHost;

internal static class AppLog
{
    private static readonly object Gate = new();
    private static readonly string LogDirectory = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
        "PocketDesk");
    private static readonly string LogPath = Path.Combine(LogDirectory, "secure-host.log");

    public static void Info(string message) => Write("INFO", message);
    public static void Error(string message) => Write("ERROR", message);

    private static void Write(string level, string message)
    {
        string line = $"{DateTimeOffset.UtcNow:O} [{level}] {message}{Environment.NewLine}";
        lock (Gate)
        {
            try
            {
                Directory.CreateDirectory(LogDirectory);
                if (File.Exists(LogPath) && new FileInfo(LogPath).Length > 2_000_000)
                {
                    string previous = Path.Combine(LogDirectory, "secure-host.previous.log");
                    File.Move(LogPath, previous, true);
                }
                File.AppendAllText(LogPath, line);
            }
            catch
            {
                // Logging must never take down the sign-in host.
            }
        }

        if (Environment.UserInteractive) Console.Error.Write(line);
    }
}
