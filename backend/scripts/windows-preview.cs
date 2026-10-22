// Compiled by Windows PowerShell 5.1. No NuGet packages or elevated API token required.
// Native API references are linked in deployment/windows/README.md.
using System;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using System.Threading;
using System.Collections.Generic;

namespace Pptinit {
    public static class WindowsPreview {
        [StructLayout(LayoutKind.Sequential)]
        struct SECURITY_CAPABILITIES {
            public IntPtr AppContainerSid, Capabilities;
            public uint CapabilityCount, Reserved;
        }
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        struct STARTUPINFO {
            public uint cb;
            public string reserved, desktop, title;
            public uint x, y, xSize, ySize, xCountChars, yCountChars, fillAttribute, flags;
            public ushort showWindow, reservedBytes;
            public IntPtr reservedPointer, stdin, stdout, stderr;
        }
        [StructLayout(LayoutKind.Sequential)]
        struct STARTUPINFOEX {
            public STARTUPINFO StartupInfo;
            public IntPtr AttributeList;
        }
        [StructLayout(LayoutKind.Sequential)]
        struct PROCESS_INFORMATION {
            public IntPtr Process, Thread;
            public uint ProcessId, ThreadId;
        }
        [StructLayout(LayoutKind.Sequential)]
        struct BASIC_LIMITS {
            public long ProcessTime, JobTime;
            public uint Flags;
            public UIntPtr MinimumWorkingSet, MaximumWorkingSet;
            public uint ActiveProcessLimit;
            public UIntPtr Affinity;
            public uint PriorityClass, SchedulingClass;
        }
        [StructLayout(LayoutKind.Sequential)]
        struct IO_COUNTERS {
            public ulong ReadOperations, WriteOperations, OtherOperations, ReadBytes, WriteBytes, OtherBytes;
        }
        [StructLayout(LayoutKind.Sequential)]
        struct EXTENDED_LIMITS {
            public BASIC_LIMITS Basic;
            public IO_COUNTERS IO;
            public UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory;
        }
        [StructLayout(LayoutKind.Sequential)]
        struct ACCOUNTING {
            public long UserTime, KernelTime, PeriodUserTime, PeriodKernelTime;
            public uint PageFaults, TotalProcesses, ActiveProcesses, TerminatedProcesses;
        }

        [DllImport("userenv.dll", CharSet = CharSet.Unicode)]
        static extern int CreateAppContainerProfile(string name, string display, string description, IntPtr capabilities, uint count, out IntPtr sid);
        [DllImport("userenv.dll", CharSet = CharSet.Unicode)]
        static extern int DeleteAppContainerProfile(string name);
        [DllImport("advapi32.dll")]
        static extern IntPtr FreeSid(IntPtr sid);
        [DllImport("kernel32.dll", SetLastError = true)]
        static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, int flags, ref IntPtr size);
        [DllImport("kernel32.dll", SetLastError = true)]
        static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, IntPtr attribute, IntPtr value, IntPtr size, IntPtr previous, IntPtr returnSize);
        [DllImport("kernel32.dll")]
        static extern void DeleteProcThreadAttributeList(IntPtr list);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        static extern bool CreateProcessW(string application, StringBuilder command, IntPtr processSecurity, IntPtr threadSecurity,
            bool inheritHandles, uint flags, IntPtr environment, string cwd, ref STARTUPINFOEX startup, out PROCESS_INFORMATION process);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        static extern IntPtr CreateJobObjectW(IntPtr security, string name);
        [DllImport("kernel32.dll", SetLastError = true)]
        static extern bool SetInformationJobObject(IntPtr job, int infoClass, ref EXTENDED_LIMITS info, uint length);
        [DllImport("kernel32.dll", SetLastError = true)]
        static extern bool QueryInformationJobObject(IntPtr job, int infoClass, out ACCOUNTING info, uint length, IntPtr returned);
        [DllImport("kernel32.dll", SetLastError = true)]
        static extern bool GetExitCodeProcess(IntPtr process, out uint code);
        [DllImport("kernel32.dll", SetLastError = true)]
        static extern bool TerminateJobObject(IntPtr job, uint code);
        [DllImport("kernel32.dll")]
        static extern bool CloseHandle(IntPtr handle);
        [DllImport("kernel32.dll")]
        static extern IntPtr LocalFree(IntPtr pointer);
        [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        static extern bool ConvertStringSecurityDescriptorToSecurityDescriptorW(string text, uint revision, out IntPtr descriptor, out uint size);
        [DllImport("advapi32.dll", SetLastError = true)]
        static extern bool GetSecurityDescriptorSacl(IntPtr descriptor, out bool present, out IntPtr sacl, out bool defaulted);
        [DllImport("advapi32.dll", CharSet = CharSet.Unicode)]
        static extern uint SetNamedSecurityInfoW(string name, int objectType, uint info, IntPtr owner, IntPtr group, IntPtr dacl, IntPtr sacl);

        static void Check(bool success, string operation) {
            if (!success) throw new Win32Exception(Marshal.GetLastWin32Error(), operation);
        }

        // Windows CRT argument quoting, including quotes and trailing backslashes.
        public static string Quote(string value) {
            StringBuilder result = new StringBuilder("\"");
            int slashes = 0;
            foreach (char c in value) {
                if (c == '\\') { slashes++; continue; }
                result.Append('\\', c == '"' ? slashes * 2 + 1 : slashes);
                result.Append(c);
                slashes = 0;
            }
            result.Append('\\', slashes * 2);
            return result.Append('"').ToString();
        }

        static void AllowJobAccess(string work, IntPtr sid) {
            DirectorySecurity acl = Directory.GetAccessControl(work);
            acl.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(sid), FileSystemRights.Modify,
                InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit,
                PropagationFlags.None, AccessControlType.Allow));
            Directory.SetAccessControl(work, acl);

            // AppContainer uses low integrity; a DACL grant alone does not permit writes.
            IntPtr descriptor = IntPtr.Zero;
            try {
                uint size;
                Check(ConvertStringSecurityDescriptorToSecurityDescriptorW("S:(ML;OICI;NW;;;LW)", 1, out descriptor, out size), "Create integrity label");
                bool present, defaulted;
                IntPtr sacl;
                Check(GetSecurityDescriptorSacl(descriptor, out present, out sacl, out defaulted), "Read integrity label");
                List<string> paths = new List<string>();
                paths.Add(work);
                paths.AddRange(Directory.GetDirectories(work, "*", SearchOption.AllDirectories));
                paths.AddRange(Directory.GetFiles(work, "*", SearchOption.AllDirectories));
                foreach (string entry in paths) {
                    uint error = SetNamedSecurityInfoW(entry, 1, 0x10, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, sacl);
                    if (error != 0) throw new Win32Exception((int)error, "Set job integrity label");
                }
            } finally {
                if (descriptor != IntPtr.Zero) LocalFree(descriptor);
            }
        }

        static IntPtr EnvironmentBlock(string executable, string work) {
            string root = Environment.GetEnvironmentVariable("SystemRoot");
            if (String.IsNullOrEmpty(root)) throw new InvalidOperationException("Missing SystemRoot");
            SortedDictionary<string, string> values = new SortedDictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            values["SystemRoot"] = root;
            values["WINDIR"] = root;
            values["Path"] = Path.GetDirectoryName(executable) + ";" + Path.Combine(root, "System32");
            values["USERPROFILE"] = work;
            values["HOME"] = work;
            values["TEMP"] = work;
            values["TMP"] = work;
            values["APPDATA"] = Path.Combine(work, "roaming");
            values["LOCALAPPDATA"] = Path.Combine(work, "local");
            StringBuilder block = new StringBuilder();
            foreach (KeyValuePair<string, string> entry in values) block.Append(entry.Key).Append('=').Append(entry.Value).Append('\0');
            block.Append('\0');
            return Marshal.StringToHGlobalUni(block.ToString());
        }

        static long DirectorySize(string directory) {
            long size = 0;
            foreach (string entry in Directory.GetFiles(directory, "*", SearchOption.AllDirectories)) {
                try { size += new FileInfo(entry).Length; }
                catch (FileNotFoundException) { }
            }
            return size;
        }

        static uint ActiveProcesses(IntPtr job) {
            ACCOUNTING info;
            Check(QueryInformationJobObject(job, 1, out info, (uint)Marshal.SizeOf(typeof(ACCOUNTING)), IntPtr.Zero), "Read converter job");
            return info.ActiveProcesses;
        }

        public static void Run(string executable, string[] args, string work) {
            executable = Path.GetFullPath(executable);
            work = Path.GetFullPath(work);
            if (!File.Exists(executable) || !Directory.Exists(work)) throw new InvalidOperationException("Converter executable or job folder is missing");
            Directory.CreateDirectory(Path.Combine(work, "roaming"));
            Directory.CreateDirectory(Path.Combine(work, "local"));
            string profile = "pptinit.preview." + Guid.NewGuid().ToString("N");
            IntPtr sid = IntPtr.Zero, job = IntPtr.Zero, attributes = IntPtr.Zero;
            IntPtr capabilities = IntPtr.Zero, jobList = IntPtr.Zero, environment = IntPtr.Zero;
            bool initialized = false;
            PROCESS_INFORMATION process = new PROCESS_INFORMATION();
            try {
                Marshal.ThrowExceptionForHR(CreateAppContainerProfile(profile, profile, "Private document preview", IntPtr.Zero, 0, out sid));
                AllowJobAccess(work, sid);
                job = CreateJobObjectW(IntPtr.Zero, null);
                Check(job != IntPtr.Zero, "Create converter job");
                EXTENDED_LIMITS limits = new EXTENDED_LIMITS();
                // Kill the entire process tree on launcher exit, bound CPU, RAM and child count.
                limits.Basic.Flags = 0x2000 | 0x200 | 0x8 | 0x4 | 0x400;
                limits.Basic.JobTime = TimeSpan.FromSeconds(80).Ticks;
                limits.Basic.ActiveProcessLimit = 16;
                limits.JobMemory = new UIntPtr(1024UL * 1024 * 1024);
                Check(SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf(typeof(EXTENDED_LIMITS))), "Set converter limits");

                IntPtr size = IntPtr.Zero;
                InitializeProcThreadAttributeList(IntPtr.Zero, 2, 0, ref size);
                attributes = Marshal.AllocHGlobal(size);
                Check(InitializeProcThreadAttributeList(attributes, 2, 0, ref size), "Initialize sandbox attributes");
                initialized = true;
                SECURITY_CAPABILITIES security = new SECURITY_CAPABILITIES();
                security.AppContainerSid = sid;
                // Zero capabilities: no internet, private network or loopback access.
                capabilities = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(SECURITY_CAPABILITIES)));
                Marshal.StructureToPtr(security, capabilities, false);
                Check(UpdateProcThreadAttribute(attributes, 0, new IntPtr(0x20009), capabilities,
                    new IntPtr(Marshal.SizeOf(typeof(SECURITY_CAPABILITIES))), IntPtr.Zero, IntPtr.Zero), "Set AppContainer");
                jobList = Marshal.AllocHGlobal(IntPtr.Size);
                Marshal.WriteIntPtr(jobList, job);
                // Atomic job assignment prevents an uncontained process if the launcher dies at startup.
                Check(UpdateProcThreadAttribute(attributes, 0, new IntPtr(0x2000D), jobList,
                    new IntPtr(IntPtr.Size), IntPtr.Zero, IntPtr.Zero), "Assign sandbox job");
                STARTUPINFOEX startup = new STARTUPINFOEX();
                startup.StartupInfo.cb = (uint)Marshal.SizeOf(typeof(STARTUPINFOEX));
                startup.AttributeList = attributes;
                StringBuilder command = new StringBuilder(Quote(executable));
                foreach (string argument in args) command.Append(' ').Append(Quote(argument));
                environment = EnvironmentBlock(executable, work);
                // EXTENDED_STARTUPINFO_PRESENT | CREATE_UNICODE_ENVIRONMENT | CREATE_NO_WINDOW
                Check(CreateProcessW(executable, command, IntPtr.Zero, IntPtr.Zero, false,
                    0x80000 | 0x400 | 0x8000000, environment, work, ref startup, out process), "Launch sandboxed LibreOffice");
                Stopwatch elapsed = Stopwatch.StartNew();
                do {
                    if (elapsed.Elapsed.TotalSeconds > 90) throw new TimeoutException("Preview conversion timed out");
                    if (DirectorySize(Path.Combine(work, "output")) > 50L * 1024 * 1024) throw new IOException("Preview exceeds 50 MB");
                    if (DirectorySize(work) > 512L * 1024 * 1024) throw new IOException("Preview temporary files exceed 512 MB");
                    Thread.Sleep(100);
                } while (ActiveProcesses(job) != 0);
                uint exitCode;
                Check(GetExitCodeProcess(process.Process, out exitCode), "Read converter exit code");
                if (exitCode != 0) throw new InvalidOperationException("LibreOffice exited with code " + exitCode);
            } finally {
                if (job != IntPtr.Zero) {
                    TerminateJobObject(job, 1);
                    // Give the OS time to release files before Node removes the job directory.
                    for (int attempt = 0; attempt < 100 && ActiveProcesses(job) != 0; attempt++) Thread.Sleep(50);
                    CloseHandle(job);
                }
                if (process.Thread != IntPtr.Zero) CloseHandle(process.Thread);
                if (process.Process != IntPtr.Zero) CloseHandle(process.Process);
                if (initialized) DeleteProcThreadAttributeList(attributes);
                if (attributes != IntPtr.Zero) Marshal.FreeHGlobal(attributes);
                if (capabilities != IntPtr.Zero) Marshal.FreeHGlobal(capabilities);
                if (jobList != IntPtr.Zero) Marshal.FreeHGlobal(jobList);
                if (environment != IntPtr.Zero) Marshal.FreeHGlobal(environment);
                if (sid != IntPtr.Zero) {
                    FreeSid(sid);
                    int result = DeleteAppContainerProfile(profile);
                    if (result < 0) Console.Error.WriteLine("Preview AppContainer cleanup failed: " + result);
                }
            }
        }
    }
}
