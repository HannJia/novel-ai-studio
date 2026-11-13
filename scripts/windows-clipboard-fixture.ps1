Add-Type @"
using System;
using System.Runtime.InteropServices;

public static class MojianClipboardFixture
{
    private const uint GmemMoveable = 0x0002;
    private const uint GmemZeroInit = 0x0040;

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool OpenClipboard(IntPtr owner);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool CloseClipboard();

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool EmptyClipboard();

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern uint RegisterClipboardFormat(string format);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr SetClipboardData(uint format, IntPtr data);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr GlobalAlloc(uint flags, UIntPtr bytes);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr GlobalFree(IntPtr memory);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr GlobalLock(IntPtr memory);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GlobalUnlock(IntPtr memory);

    public static void Write(string format, byte[] value)
    {
        var formatId = RegisterClipboardFormat(format);
        if (formatId == 0) throw new InvalidOperationException("RegisterClipboardFormat failed: " + Marshal.GetLastWin32Error());
        if (!OpenClipboard(IntPtr.Zero)) throw new InvalidOperationException("OpenClipboard failed: " + Marshal.GetLastWin32Error());

        IntPtr memory = IntPtr.Zero;
        try
        {
            if (!EmptyClipboard()) throw new InvalidOperationException("EmptyClipboard failed: " + Marshal.GetLastWin32Error());
            memory = GlobalAlloc(GmemMoveable | GmemZeroInit, (UIntPtr)value.Length);
            if (memory == IntPtr.Zero) throw new InvalidOperationException("GlobalAlloc failed: " + Marshal.GetLastWin32Error());
            var target = GlobalLock(memory);
            if (target == IntPtr.Zero) throw new InvalidOperationException("GlobalLock failed: " + Marshal.GetLastWin32Error());
            Marshal.Copy(value, 0, target, value.Length);
            GlobalUnlock(memory);
            if (SetClipboardData(formatId, memory) == IntPtr.Zero) {
                throw new InvalidOperationException("SetClipboardData failed: " + Marshal.GetLastWin32Error());
            }
            memory = IntPtr.Zero;
        }
        finally
        {
            if (memory != IntPtr.Zero) GlobalFree(memory);
            CloseClipboard();
        }
    }
}
"@

[MojianClipboardFixture]::Write('Mojian Smoke Custom Format', [Text.Encoding]::UTF8.GetBytes('custom-format-test'))
