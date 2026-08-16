using System.Runtime.InteropServices;
using System.Text.Json;

namespace PocketDesk.SecureHost;

internal static class InputInjector
{
    private static readonly IReadOnlyDictionary<string, ushort> AllowedKeys = new Dictionary<string, ushort>(StringComparer.Ordinal)
    {
        ["Backspace"] = 0x08,
        ["Enter"] = 0x0D,
        ["Escape"] = 0x1B,
        ["Tab"] = 0x09,
        ["Space"] = 0x20,
        ["Left"] = 0x25,
        ["Up"] = 0x26,
        ["Right"] = 0x27,
        ["Down"] = 0x28,
        ["Home"] = 0x24,
        ["End"] = 0x23,
        ["Delete"] = 0x2E,
    };

    public static void Apply(JsonElement payload)
    {
        if (payload.ValueKind != JsonValueKind.Object ||
            !payload.TryGetProperty("kind", out JsonElement kindValue) ||
            kindValue.ValueKind != JsonValueKind.String)
        {
            return;
        }

        string kind = kindValue.GetString() ?? "";
        if (kind == "secureAttention")
        {
            try { NativeMethods.SendSAS(false); }
            catch (Exception exception) when (exception is DllNotFoundException or EntryPointNotFoundException)
            {
                AppLog.Error($"Windows secure attention is unavailable: {exception.Message}");
            }
            return;
        }

        if (kind is "pointerDown" or "pointerMove" or "pointerUp" or "tap" or "doubleClick")
        {
            if (!TryUnit(payload, "x", out double x) || !TryUnit(payload, "y", out double y)) return;
            MovePointer(x, y);
            if (kind is "pointerDown") Mouse(NativeMethods.MouseEventLeftDown);
            if (kind is "pointerUp") Mouse(NativeMethods.MouseEventLeftUp);
            if (kind is "tap") Click(NativeMethods.MouseEventLeftDown, NativeMethods.MouseEventLeftUp);
            if (kind is "doubleClick")
            {
                Click(NativeMethods.MouseEventLeftDown, NativeMethods.MouseEventLeftUp);
                Thread.Sleep(80);
                Click(NativeMethods.MouseEventLeftDown, NativeMethods.MouseEventLeftUp);
            }
            return;
        }

        if (kind == "moveRelative" &&
            TryFinite(payload, "dx", out double dx) &&
            TryFinite(payload, "dy", out double dy) &&
            NativeMethods.GetCursorPos(out NativeMethods.POINT point))
        {
            NativeMethods.SetCursorPos(
                point.x + (int)Math.Clamp(dx, -200, 200),
                point.y + (int)Math.Clamp(dy, -200, 200));
            return;
        }

        if (kind == "leftClick")
        {
            Click(NativeMethods.MouseEventLeftDown, NativeMethods.MouseEventLeftUp);
            return;
        }
        if (kind == "leftDown")
        {
            Mouse(NativeMethods.MouseEventLeftDown);
            return;
        }
        if (kind == "leftUp")
        {
            Mouse(NativeMethods.MouseEventLeftUp);
            return;
        }
        if (kind == "rightClick")
        {
            Click(NativeMethods.MouseEventRightDown, NativeMethods.MouseEventRightUp);
            return;
        }
        if (kind == "scroll" && TryFinite(payload, "delta", out double delta))
        {
            NativeMethods.mouse_event(
                NativeMethods.MouseEventWheel,
                0,
                0,
                unchecked((uint)(int)Math.Clamp(delta, -1_200, 1_200)),
                UIntPtr.Zero);
            return;
        }
        if (kind == "key" &&
            payload.TryGetProperty("key", out JsonElement key) &&
            key.ValueKind == JsonValueKind.String &&
            AllowedKeys.TryGetValue(key.GetString() ?? "", out ushort virtualKey))
        {
            SendVirtualKey(virtualKey);
            return;
        }
        if (kind == "text" &&
            payload.TryGetProperty("text", out JsonElement textValue) &&
            textValue.ValueKind == JsonValueKind.String)
        {
            string text = textValue.GetString() ?? "";
            if (text.Length <= 2_000) SendUnicode(text);
        }
    }

    private static void MovePointer(double normalizedX, double normalizedY)
    {
        int left = NativeMethods.GetSystemMetrics(NativeMethods.SmXVirtualScreen);
        int top = NativeMethods.GetSystemMetrics(NativeMethods.SmYVirtualScreen);
        int width = Math.Max(1, NativeMethods.GetSystemMetrics(NativeMethods.SmCxVirtualScreen));
        int height = Math.Max(1, NativeMethods.GetSystemMetrics(NativeMethods.SmCyVirtualScreen));
        NativeMethods.SetCursorPos(
            left + (int)Math.Round(normalizedX * (width - 1)),
            top + (int)Math.Round(normalizedY * (height - 1)));
    }

    private static void Click(uint down, uint up)
    {
        Mouse(down);
        Thread.Sleep(24);
        Mouse(up);
    }

    private static void Mouse(uint flags) =>
        NativeMethods.mouse_event(flags, 0, 0, 0, UIntPtr.Zero);

    private static void SendVirtualKey(ushort virtualKey)
    {
        NativeMethods.INPUT[] inputs =
        [
            KeyboardInput(virtualKey, '\0', 0),
            KeyboardInput(virtualKey, '\0', NativeMethods.KeyEventKeyUp),
        ];
        NativeMethods.SendInput((uint)inputs.Length, inputs, Marshal.SizeOf<NativeMethods.INPUT>());
    }

    private static void SendUnicode(string text)
    {
        foreach (char character in text)
        {
            NativeMethods.INPUT[] inputs =
            [
                KeyboardInput(0, character, NativeMethods.KeyEventUnicode),
                KeyboardInput(0, character, NativeMethods.KeyEventUnicode | NativeMethods.KeyEventKeyUp),
            ];
            NativeMethods.SendInput((uint)inputs.Length, inputs, Marshal.SizeOf<NativeMethods.INPUT>());
        }
    }

    private static NativeMethods.INPUT KeyboardInput(ushort virtualKey, char scanCode, uint flags) => new()
    {
        type = NativeMethods.InputKeyboard,
        data = new NativeMethods.INPUT_UNION
        {
            keyboard = new NativeMethods.KEYBDINPUT
            {
                virtualKey = virtualKey,
                scanCode = scanCode,
                flags = flags,
            },
        },
    };

    private static bool TryUnit(JsonElement payload, string name, out double value) =>
        TryFinite(payload, name, out value) && value is >= 0 and <= 1;

    private static bool TryFinite(JsonElement payload, string name, out double value)
    {
        value = 0;
        return payload.TryGetProperty(name, out JsonElement property) &&
            property.TryGetDouble(out value) &&
            double.IsFinite(value);
    }
}
