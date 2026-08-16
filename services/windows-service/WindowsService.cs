using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

namespace PocketDesk.SecureHost;

internal static class WindowsService
{
    internal const string ServiceName = "PocketDeskSecureHost";

    private static readonly ManualResetEvent StopEvent = new(false);
    private static readonly AutoResetEvent SessionChangedEvent = new(false);
    private static readonly NativeMethods.ServiceMainDelegate ServiceMainCallback = ServiceMain;
    private static readonly NativeMethods.ServiceControlHandlerDelegate ControlHandlerCallback = ControlHandler;
    private static IntPtr _statusHandle;
    private static NativeMethods.SERVICE_STATUS _status;

    public static bool Run()
    {
        NativeMethods.SERVICE_TABLE_ENTRY[] table =
        [
            new() { serviceName = ServiceName, serviceMain = ServiceMainCallback },
            new() { serviceName = null, serviceMain = null },
        ];
        return NativeMethods.StartServiceCtrlDispatcher(table);
    }

    private static void ServiceMain(uint argumentCount, IntPtr arguments)
    {
        _statusHandle = NativeMethods.RegisterServiceCtrlHandlerEx(
            ServiceName,
            ControlHandlerCallback,
            IntPtr.Zero);
        if (_statusHandle == IntPtr.Zero)
        {
            AppLog.Error($"RegisterServiceCtrlHandlerEx failed ({Marshal.GetLastWin32Error()}).");
            return;
        }

        ReportStatus(NativeMethods.ServiceStartPending, 0, 10_000);
        try
        {
            AppLog.Info("PocketDesk Secure Host service starting.");
            ReportStatus(
                NativeMethods.ServiceRunning,
                NativeMethods.ServiceAcceptStop |
                NativeMethods.ServiceAcceptShutdown |
                NativeMethods.ServiceAcceptSessionChange,
                0);
            SuperviseWorker();
            ReportStatus(NativeMethods.ServiceStopped, 0, 0);
            AppLog.Info("PocketDesk Secure Host service stopped.");
        }
        catch (Exception exception)
        {
            AppLog.Error($"Service failure: {exception}");
            ReportStatus(NativeMethods.ServiceStopped, 0, 0, 1);
        }
    }

    private static uint ControlHandler(uint control, uint eventType, IntPtr eventData, IntPtr context)
    {
        if (control is NativeMethods.ServiceControlStop or NativeMethods.ServiceControlShutdown)
        {
            ReportStatus(NativeMethods.ServiceStopPending, 0, 8_000);
            StopEvent.Set();
            SessionChangedEvent.Set();
        }
        else if (control == NativeMethods.ServiceControlSessionChange)
        {
            SessionChangedEvent.Set();
        }
        return 0;
    }

    private static void SuperviseWorker()
    {
        Process? worker = null;
        uint workerSession = NativeMethods.InvalidSessionId;
        WaitHandle[] waits = [StopEvent, SessionChangedEvent];

        while (!StopEvent.WaitOne(0))
        {
            uint desiredSession = NativeMethods.WTSGetActiveConsoleSessionId();
            bool workerExited = worker is null || HasExited(worker);
            bool sessionChanged = desiredSession != workerSession;

            if (desiredSession == NativeMethods.InvalidSessionId)
            {
                StopWorker(ref worker);
                workerSession = NativeMethods.InvalidSessionId;
            }
            else if (workerExited || sessionChanged)
            {
                StopWorker(ref worker);
                try
                {
                    worker = LaunchWorker(desiredSession);
                    workerSession = desiredSession;
                }
                catch (Exception exception)
                {
                    workerSession = NativeMethods.InvalidSessionId;
                    AppLog.Error($"Secure worker launch failed; retrying: {exception.Message}");
                }
            }

            WaitHandle.WaitAny(waits, TimeSpan.FromSeconds(2));
        }

        StopWorker(ref worker);
    }

    private static Process LaunchWorker(uint sessionId)
    {
        IntPtr processToken = IntPtr.Zero;
        IntPtr primaryToken = IntPtr.Zero;
        IntPtr environment = IntPtr.Zero;
        try
        {
            uint access = NativeMethods.TokenAssignPrimary |
                NativeMethods.TokenDuplicate |
                NativeMethods.TokenQuery |
                NativeMethods.TokenAdjustDefault |
                NativeMethods.TokenAdjustSessionId;
            if (!NativeMethods.OpenProcessToken(NativeMethods.GetCurrentProcess(), access, out processToken))
            {
                throw new Win32Exception(Marshal.GetLastWin32Error(), "Could not open the service token");
            }
            if (!NativeMethods.DuplicateTokenEx(
                processToken,
                access,
                IntPtr.Zero,
                NativeMethods.SecurityImpersonation,
                NativeMethods.TokenPrimary,
                out primaryToken))
            {
                throw new Win32Exception(Marshal.GetLastWin32Error(), "Could not duplicate the service token");
            }
            uint targetSession = sessionId;
            if (!NativeMethods.SetTokenInformation(
                primaryToken,
                NativeMethods.TokenSessionId,
                ref targetSession,
                sizeof(uint)))
            {
                throw new Win32Exception(Marshal.GetLastWin32Error(), "Could not attach the worker token to the console session");
            }

            uint creationFlags = NativeMethods.CreateNoWindow;
            if (NativeMethods.CreateEnvironmentBlock(out environment, primaryToken, false))
            {
                creationFlags |= NativeMethods.CreateUnicodeEnvironment;
            }

            string executable = Environment.ProcessPath
                ?? throw new InvalidOperationException("The service executable path is unavailable.");
            StringBuilder command = new($"\"{executable}\" --worker --session {sessionId}");
            NativeMethods.STARTUPINFO startup = new()
            {
                cb = (uint)Marshal.SizeOf<NativeMethods.STARTUPINFO>(),
                desktop = "winsta0\\default",
            };
            if (!NativeMethods.CreateProcessAsUser(
                primaryToken,
                null,
                command,
                IntPtr.Zero,
                IntPtr.Zero,
                false,
                creationFlags,
                environment,
                AppContext.BaseDirectory,
                ref startup,
                out NativeMethods.PROCESS_INFORMATION processInformation))
            {
                throw new Win32Exception(Marshal.GetLastWin32Error(), "Could not start the secure desktop worker");
            }

            try
            {
                Process result = Process.GetProcessById((int)processInformation.processId);
                AppLog.Info($"Started secure desktop worker {result.Id} in session {sessionId}.");
                return result;
            }
            finally
            {
                NativeMethods.CloseHandle(processInformation.thread);
                NativeMethods.CloseHandle(processInformation.process);
            }
        }
        finally
        {
            if (environment != IntPtr.Zero) NativeMethods.DestroyEnvironmentBlock(environment);
            if (primaryToken != IntPtr.Zero) NativeMethods.CloseHandle(primaryToken);
            if (processToken != IntPtr.Zero) NativeMethods.CloseHandle(processToken);
        }
    }

    private static bool HasExited(Process process)
    {
        try { return process.HasExited; }
        catch { return true; }
    }

    private static void StopWorker(ref Process? process)
    {
        if (process is null) return;
        try
        {
            if (!process.HasExited)
            {
                process.Kill(true);
                process.WaitForExit(4_000);
            }
        }
        catch (Exception exception)
        {
            AppLog.Error($"Could not stop secure worker cleanly: {exception.Message}");
        }
        finally
        {
            process.Dispose();
            process = null;
        }
    }

    private static void ReportStatus(uint state, uint acceptedControls, uint waitHint, uint exitCode = 0)
    {
        if (_statusHandle == IntPtr.Zero) return;
        _status = new NativeMethods.SERVICE_STATUS
        {
            serviceType = NativeMethods.ServiceWin32OwnProcess,
            currentState = state,
            controlsAccepted = acceptedControls,
            win32ExitCode = exitCode,
            waitHint = waitHint,
        };
        NativeMethods.SetServiceStatus(_statusHandle, ref _status);
    }
}
