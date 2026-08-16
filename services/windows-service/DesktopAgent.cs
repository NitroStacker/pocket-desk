using System.Collections.Concurrent;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Text.Json;

namespace PocketDesk.SecureHost;

internal sealed record CaptureProfile(string Name, int Width, long Quality, int Fps)
{
    public static CaptureProfile FromName(string? name) => name switch
    {
        "smooth" => new("smooth", 960, 44, 5),
        "sharp" => new("sharp", 1600, 68, 3),
        _ => new("balanced", 1280, 56, 4),
    };
}

internal sealed class DesktopAgent : IDisposable
{
    private readonly string _desktopName;
    private readonly Func<bool> _shouldCapture;
    private readonly Func<CaptureProfile> _profile;
    private readonly Action<byte[]> _onFrame;
    private readonly Action<object> _onMeta;
    private readonly CancellationTokenSource _stop = new();
    private readonly ConcurrentQueue<JsonElement> _inputs = new();
    private readonly Thread _thread;

    public DesktopAgent(
        string desktopName,
        Func<bool> shouldCapture,
        Func<CaptureProfile> profile,
        Action<byte[]> onFrame,
        Action<object> onMeta)
    {
        _desktopName = desktopName;
        _shouldCapture = shouldCapture;
        _profile = profile;
        _onFrame = onFrame;
        _onMeta = onMeta;
        _thread = new Thread(Run)
        {
            IsBackground = true,
            Name = "PocketDesk secure desktop",
        };
    }

    public bool IsAlive => _thread.IsAlive;

    public void Start() => _thread.Start();

    public void Enqueue(JsonElement input)
    {
        if (_inputs.Count < 100) _inputs.Enqueue(input.Clone());
    }

    public void Dispose()
    {
        _stop.Cancel();
        if (_thread.IsAlive && Thread.CurrentThread != _thread) _thread.Join(2_000);
        _stop.Dispose();
    }

    private void Run()
    {
        IntPtr originalDesktop = NativeMethods.GetThreadDesktop(NativeMethods.GetCurrentThreadId());
        IntPtr inputDesktop = IntPtr.Zero;
        try
        {
            inputDesktop = DesktopEnvironment.OpenAndAttach(_desktopName);
            string lastProfile = "";
            long nextFrameAt = 0;

            while (!_stop.IsCancellationRequested)
            {
                while (_inputs.TryDequeue(out JsonElement input)) InputInjector.Apply(input);

                if (!_shouldCapture())
                {
                    _stop.Token.WaitHandle.WaitOne(50);
                    continue;
                }

                CaptureProfile profile = _profile();
                if (profile.Name != lastProfile)
                {
                    _onMeta(CreateMeta(profile));
                    lastProfile = profile.Name;
                }

                long now = Environment.TickCount64;
                if (now < nextFrameAt)
                {
                    _stop.Token.WaitHandle.WaitOne((int)Math.Min(50, nextFrameAt - now));
                    continue;
                }

                _onFrame(CaptureJpeg(profile));
                nextFrameAt = Environment.TickCount64 + Math.Max(100, 1_000 / profile.Fps);
            }
        }
        catch (Exception exception)
        {
            if (!_stop.IsCancellationRequested) AppLog.Error($"Secure desktop agent stopped: {exception.Message}");
        }
        finally
        {
            if (originalDesktop != IntPtr.Zero) NativeMethods.SetThreadDesktop(originalDesktop);
            if (inputDesktop != IntPtr.Zero) NativeMethods.CloseDesktop(inputDesktop);
        }
    }

    private static object CreateMeta(CaptureProfile profile)
    {
        (int left, int top, int width, int height) = SourceBounds();
        int streamWidth = Math.Min(width, profile.Width);
        int streamHeight = Math.Max(1, (int)Math.Round(height * streamWidth / (double)width));
        return new
        {
            machineName = Environment.MachineName,
            sourceWidth = width,
            sourceHeight = height,
            streamWidth,
            streamHeight,
            left,
            top,
            fps = profile.Fps,
            quality = profile.Quality,
            profile = profile.Name,
        };
    }

    private static byte[] CaptureJpeg(CaptureProfile profile)
    {
        (int left, int top, int width, int height) = SourceBounds();
        int streamWidth = Math.Min(width, profile.Width);
        int streamHeight = Math.Max(1, (int)Math.Round(height * streamWidth / (double)width));

        using Bitmap source = new(width, height, PixelFormat.Format32bppArgb);
        using (Graphics graphics = Graphics.FromImage(source))
        {
            graphics.CopyFromScreen(left, top, 0, 0, new Size(width, height), CopyPixelOperation.SourceCopy);
        }

        using Bitmap output = streamWidth == width
            ? new Bitmap(source)
            : Resize(source, streamWidth, streamHeight);
        using MemoryStream stream = new();
        ImageCodecInfo jpeg = ImageCodecInfo.GetImageEncoders().First(codec => codec.FormatID == ImageFormat.Jpeg.Guid);
        using EncoderParameters parameters = new(1);
        parameters.Param[0] = new EncoderParameter(Encoder.Quality, profile.Quality);
        output.Save(stream, jpeg, parameters);
        return stream.ToArray();
    }

    private static Bitmap Resize(Bitmap source, int width, int height)
    {
        Bitmap output = new(width, height, PixelFormat.Format24bppRgb);
        using Graphics graphics = Graphics.FromImage(output);
        graphics.CompositingMode = CompositingMode.SourceCopy;
        graphics.CompositingQuality = CompositingQuality.HighSpeed;
        graphics.InterpolationMode = InterpolationMode.HighQualityBilinear;
        graphics.SmoothingMode = SmoothingMode.None;
        graphics.PixelOffsetMode = PixelOffsetMode.HighSpeed;
        graphics.DrawImage(source, new Rectangle(0, 0, width, height));
        return output;
    }

    private static (int Left, int Top, int Width, int Height) SourceBounds()
    {
        int left = NativeMethods.GetSystemMetrics(NativeMethods.SmXVirtualScreen);
        int top = NativeMethods.GetSystemMetrics(NativeMethods.SmYVirtualScreen);
        int width = Math.Max(1, NativeMethods.GetSystemMetrics(NativeMethods.SmCxVirtualScreen));
        int height = Math.Max(1, NativeMethods.GetSystemMetrics(NativeMethods.SmCyVirtualScreen));
        return (left, top, width, height);
    }
}
