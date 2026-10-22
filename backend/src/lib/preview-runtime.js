const path = require("node:path");

function validatePreviewConfiguration(env = process.env, platform = process.platform) {
  if (!env.LIBREOFFICE_PATH) return;
  if (platform === "win32") {
    if (env.PREVIEW_SANDBOX_PATH) {
      throw new Error("Unset PREVIEW_SANDBOX_PATH on Windows; the bundled AppContainer launcher is used automatically");
    }
    if (!path.win32.isAbsolute(env.LIBREOFFICE_PATH) || !/\.(exe|com)$/i.test(env.LIBREOFFICE_PATH)) {
      throw new Error("LIBREOFFICE_PATH must be an absolute Windows path to soffice.com or soffice.exe");
    }
  } else if (env.NODE_ENV === "production" && !env.PREVIEW_SANDBOX_PATH) {
    throw new Error("Production Office previews require PREVIEW_SANDBOX_PATH for isolated conversion");
  }
}

// Never pass database credentials, signing keys, or scanner settings to a converter.
function previewEnvironment(work, env = process.env, platform = process.platform) {
  if (platform !== "win32") {
    return {
      PATH: env.PATH,
      HOME: work,
      TMPDIR: work,
      LANG: "en_US.UTF-8",
      SAL_USE_VCLPLUGIN: "svp",
      LIBREOFFICE_RUNTIME_DIR: env.LIBREOFFICE_RUNTIME_DIR,
    };
  }
  const result = {};
  for (const key of ["SystemRoot", "WINDIR", "USERPROFILE", "LOCALAPPDATA", "APPDATA", "ProgramFiles", "ProgramFiles(x86)", "ProgramW6432"]) {
    const entry = Object.keys(env).find((name) => name.toLowerCase() === key.toLowerCase() && env[name]);
    if (entry && env[entry]) result[key] = env[entry];
  }
  if (!result.SystemRoot) throw new Error("Windows SystemRoot is required for preview conversion");
  // PowerShell needs the service account's profile to create an AppContainer.
  // The native launcher gives the converter a separate, job-only environment.
  result.Path = path.win32.join(result.SystemRoot, "System32");
  result.TEMP = work;
  result.TMP = work;
  return result;
}

function previewCommand(executable, args, work, env = process.env, platform = process.platform) {
  if (platform === "win32") {
    const environment = previewEnvironment(work, env, platform);
    return {
      executable: path.win32.join(environment.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
      args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-File",
        path.resolve(__dirname, "../../scripts/windows-preview.ps1"),
        "-JobFile", path.win32.join(work, "preview-job.json")],
      options: { cwd: work, env: environment, windowsHide: true, timeout: 110000, maxBuffer: 1024 * 1024, killSignal: "SIGKILL" },
    };
  }
  return {
    executable: env.PREVIEW_SANDBOX_PATH || executable,
    args: [...(env.PREVIEW_SANDBOX_PATH ? [executable] : []), ...args],
    options: { cwd: work, env: previewEnvironment(work, env, platform), timeout: 90000, maxBuffer: 1024 * 1024, killSignal: "SIGKILL" },
  };
}

module.exports = { validatePreviewConfiguration, previewEnvironment, previewCommand };
