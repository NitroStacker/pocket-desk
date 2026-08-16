using System.Text.Json;

namespace PocketDesk.SecureHost;

internal sealed class SecureWorker : IDisposable
{
    private readonly uint _sessionId;
    private readonly RelayClient _relay;
    private DesktopAgent? _agent;
    private int _active;
    private int _viewerCount;
    private int _streamEnabled;
    private string _profileName = "balanced";
    private string _desktopName = "";
    private int? _unlockedSessionFlag = LoadUnlockedSessionFlag();

    private SecureWorker(uint sessionId, MachineConfig config)
    {
        _sessionId = sessionId;
        _relay = new RelayClient(config, HandleRelayMessage, PublishState);
    }

    public static async Task RunAsync(uint sessionId)
    {
        MachineConfig config = MachineConfig.Load();
        using CancellationTokenSource stop = new();
        Console.CancelKeyPress += (_, eventArgs) =>
        {
            eventArgs.Cancel = true;
            stop.Cancel();
        };
        AppDomain.CurrentDomain.ProcessExit += (_, _) => stop.Cancel();

        using SecureWorker worker = new(sessionId, config);
        AppLog.Info($"Secure desktop worker running in console session {sessionId}.");
        await Task.WhenAll(
            worker._relay.RunAsync(stop.Token),
            worker.MonitorDesktopAsync(stop.Token));
    }

    public void Dispose()
    {
        _agent?.Dispose();
        _relay.Dispose();
    }

    private async Task MonitorDesktopAsync(CancellationToken cancellationToken)
    {
        while (!cancellationToken.IsCancellationRequested)
        {
            string name = DesktopEnvironment.GetInputDesktopName() ?? "";
            bool userNameKnown = DesktopEnvironment.TryGetSessionUserName(_sessionId, out string userName);
            if (name.Equals("Default", StringComparison.OrdinalIgnoreCase) &&
                !string.IsNullOrWhiteSpace(userName) &&
                DesktopEnvironment.TryGetSessionFlag(_sessionId, out int observedUnlockedFlag))
            {
                _unlockedSessionFlag = observedUnlockedFlag;
                SaveUnlockedSessionFlag(observedUnlockedFlag);
            }
            bool active = DesktopEnvironment.IsWindowsSignInDesktop(
                _sessionId,
                name,
                userNameKnown,
                userName,
                _unlockedSessionFlag);
            bool changed = active != (Volatile.Read(ref _active) == 1) ||
                !name.Equals(_desktopName, StringComparison.OrdinalIgnoreCase);

            if (changed || (active && (_agent is null || !_agent.IsAlive)))
            {
                _agent?.Dispose();
                _agent = null;
                _desktopName = name;
                Volatile.Write(ref _active, active ? 1 : 0);

                if (active)
                {
                    _agent = new DesktopAgent(
                        name,
                        () => Volatile.Read(ref _active) == 1 &&
                            Volatile.Read(ref _viewerCount) > 0 &&
                            Volatile.Read(ref _streamEnabled) == 1,
                        () => CaptureProfile.FromName(Volatile.Read(ref _profileName)),
                        frame => _relay.TrySendFrame(frame),
                        meta => _relay.SendJson(new { type = "desktop-meta", payload = meta }));
                    _agent.Start();
                    AppLog.Info("Windows sign-in desktop became active.");
                }
                else if (changed)
                {
                    AppLog.Info("Windows sign-in desktop became inactive.");
                }
                PublishState();
            }

            try { await Task.Delay(350, cancellationToken); }
            catch (OperationCanceledException) { break; }
        }
    }

    private void HandleRelayMessage(string raw)
    {
        try
        {
            using JsonDocument document = JsonDocument.Parse(raw);
            JsonElement root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object ||
                !root.TryGetProperty("type", out JsonElement typeValue) ||
                typeValue.ValueKind != JsonValueKind.String)
            {
                return;
            }

            string type = typeValue.GetString() ?? "";
            if (type == "relay-status" &&
                root.TryGetProperty("viewerCount", out JsonElement viewerCount) &&
                viewerCount.TryGetInt32(out int count))
            {
                Volatile.Write(ref _viewerCount, Math.Clamp(count, 0, 100));
                return;
            }

            if (type == "set-stream" && TryPayload(root, out JsonElement streamPayload))
            {
                Volatile.Write(
                    ref _streamEnabled,
                    streamPayload.TryGetProperty("enabled", out JsonElement enabled) && enabled.ValueKind == JsonValueKind.True ? 1 : 0);
                return;
            }

            if (type == "set-quality" && TryPayload(root, out JsonElement qualityPayload) &&
                qualityPayload.TryGetProperty("profile", out JsonElement profile) &&
                profile.ValueKind == JsonValueKind.String)
            {
                string requested = profile.GetString() ?? "";
                if (requested is "smooth" or "balanced" or "sharp") Volatile.Write(ref _profileName, requested);
                return;
            }

            if (type == "ping" && root.TryGetProperty("timestamp", out JsonElement timestamp) && timestamp.TryGetInt64(out long sentAt))
            {
                _relay.SendJson(new { type = "pong", timestamp = sentAt });
                return;
            }

            if (type == "input" && Volatile.Read(ref _active) == 1 && TryPayload(root, out JsonElement input))
            {
                _agent?.Enqueue(input);
            }
        }
        catch (JsonException)
        {
            // The relay already validates message envelopes. Ignore malformed payloads defensively.
        }
    }

    private void PublishState()
    {
        _relay.SendJson(new
        {
            type = "secure-status",
            active = Volatile.Read(ref _active) == 1,
            desktopName = _desktopName,
        });
    }

    private static bool TryPayload(JsonElement root, out JsonElement payload)
    {
        if (root.TryGetProperty("payload", out payload) && payload.ValueKind == JsonValueKind.Object) return true;
        payload = default;
        return false;
    }

    private static int? LoadUnlockedSessionFlag()
    {
        try
        {
            string path = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
                "PocketDesk",
                "unlocked-session.flag");
            string value = File.ReadAllText(path).Trim();
            return value is "0" or "1" ? int.Parse(value) : null;
        }
        catch
        {
            return null;
        }
    }

    private static void SaveUnlockedSessionFlag(int value)
    {
        try
        {
            string path = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
                "PocketDesk",
                "unlocked-session.flag");
            if (!File.Exists(path) || File.ReadAllText(path).Trim() != value.ToString())
            {
                File.WriteAllText(path, value.ToString());
            }
        }
        catch (Exception exception)
        {
            AppLog.Error($"Could not save the Windows session-state calibration: {exception.Message}");
        }
    }
}
