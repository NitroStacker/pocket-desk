using System.Net.WebSockets;
using System.Text;
using System.Text.Json;

namespace PocketDesk.SecureHost;

internal sealed class RelayClient : IDisposable
{
    private readonly MachineConfig _config;
    private readonly Action<string> _onMessage;
    private readonly Action _onConnected;
    private readonly object _socketGate = new();
    private readonly SemaphoreSlim _sendGate = new(1, 1);
    private ClientWebSocket? _socket;
    private int _frameSending;

    public RelayClient(MachineConfig config, Action<string> onMessage, Action onConnected)
    {
        _config = config;
        _onMessage = onMessage;
        _onConnected = onConnected;
    }

    public async Task RunAsync(CancellationToken cancellationToken)
    {
        int attempt = 0;
        while (!cancellationToken.IsCancellationRequested)
        {
            using ClientWebSocket socket = new();
            socket.Options.AddSubProtocol("pocketdesk-v1");
            socket.Options.AddSubProtocol($"secure.{_config.HostToken}");
            socket.Options.KeepAliveInterval = TimeSpan.FromSeconds(15);

            try
            {
                await socket.ConnectAsync(BuildSocketUri(), cancellationToken);
                lock (_socketGate) _socket = socket;
                attempt = 0;
                AppLog.Info("Secure desktop worker connected to the relay.");
                _onConnected();
                await ReceiveAsync(socket, cancellationToken);
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception exception)
            {
                AppLog.Error($"Secure relay connection failed: {exception.Message}");
            }
            finally
            {
                lock (_socketGate)
                {
                    if (ReferenceEquals(_socket, socket)) _socket = null;
                }
            }

            if (cancellationToken.IsCancellationRequested) break;
            int delay = Math.Min(10_000, 1_000 * (1 << Math.Min(attempt, 3)));
            attempt++;
            try { await Task.Delay(delay, cancellationToken); }
            catch (OperationCanceledException) { break; }
        }
    }

    public void SendJson(object value)
    {
        byte[] bytes = JsonSerializer.SerializeToUtf8Bytes(value);
        _ = SendAsync(bytes, WebSocketMessageType.Text, CancellationToken.None);
    }

    public void TrySendFrame(byte[] frame)
    {
        if (Interlocked.CompareExchange(ref _frameSending, 1, 0) != 0) return;
        _ = SendFrameAsync(frame);
    }

    public void Dispose()
    {
        lock (_socketGate) _socket?.Abort();
        _sendGate.Dispose();
    }

    private async Task SendFrameAsync(byte[] frame)
    {
        try { await SendAsync(frame, WebSocketMessageType.Binary, CancellationToken.None); }
        finally { Volatile.Write(ref _frameSending, 0); }
    }

    private async Task SendAsync(byte[] value, WebSocketMessageType type, CancellationToken cancellationToken)
    {
        ClientWebSocket? socket;
        lock (_socketGate) socket = _socket;
        if (socket?.State != WebSocketState.Open) return;

        bool acquired = false;
        try
        {
            await _sendGate.WaitAsync(cancellationToken);
            acquired = true;
            if (socket.State == WebSocketState.Open)
            {
                await socket.SendAsync(value, type, true, cancellationToken);
            }
        }
        catch (Exception exception) when (exception is WebSocketException or ObjectDisposedException or OperationCanceledException)
        {
            if (exception is not OperationCanceledException) AppLog.Error($"Secure relay send failed: {exception.Message}");
        }
        finally
        {
            if (acquired)
            {
                try { _sendGate.Release(); }
                catch (ObjectDisposedException) { }
            }
        }
    }

    private async Task ReceiveAsync(ClientWebSocket socket, CancellationToken cancellationToken)
    {
        byte[] buffer = new byte[16_384];
        while (socket.State == WebSocketState.Open && !cancellationToken.IsCancellationRequested)
        {
            using MemoryStream message = new();
            WebSocketReceiveResult result;
            do
            {
                result = await socket.ReceiveAsync(buffer, cancellationToken);
                if (result.MessageType == WebSocketMessageType.Close) return;
                if (message.Length + result.Count > 128_000)
                {
                    await socket.CloseAsync(WebSocketCloseStatus.MessageTooBig, "Message too large", cancellationToken);
                    return;
                }
                message.Write(buffer, 0, result.Count);
            }
            while (!result.EndOfMessage);

            if (result.MessageType == WebSocketMessageType.Text)
            {
                _onMessage(Encoding.UTF8.GetString(message.GetBuffer(), 0, (int)message.Length));
            }
        }
    }

    private Uri BuildSocketUri()
    {
        Uri relay = new(_config.RelayUrl);
        UriBuilder builder = new(relay)
        {
            Scheme = Uri.UriSchemeWss,
            Port = relay.IsDefaultPort ? -1 : relay.Port,
            Path = $"/connect/{_config.SessionId}",
            Query = "",
        };
        return builder.Uri;
    }
}
