function validatePreviewConfiguration(env = process.env) {
  if (
    env.NODE_ENV === "production" &&
    env.LIBREOFFICE_PATH &&
    !env.PREVIEW_SANDBOX_PATH
  ) {
    throw new Error(
      "Production Office previews require PREVIEW_SANDBOX_PATH for isolated conversion",
    );
  }
}

// Never pass database credentials, signing keys, or scanner settings to a converter.
function previewEnvironment(work, env = process.env) {
  return {
    PATH: env.PATH,
    HOME: work,
    TMPDIR: work,
    LANG: "en_US.UTF-8",
    SAL_USE_VCLPLUGIN: "svp",
    LIBREOFFICE_RUNTIME_DIR: env.LIBREOFFICE_RUNTIME_DIR,
  };
}

function previewCommand(executable, args, work, env = process.env) {
  return {
    executable: env.PREVIEW_SANDBOX_PATH || executable,
    args: [...(env.PREVIEW_SANDBOX_PATH ? [executable] : []), ...args],
    options: {
      cwd: work,
      env: previewEnvironment(work, env),
      timeout: 90000,
      maxBuffer: 1024 * 1024,
      killSignal: "SIGKILL",
    },
  };
}

module.exports = { validatePreviewConfiguration, previewEnvironment, previewCommand };
