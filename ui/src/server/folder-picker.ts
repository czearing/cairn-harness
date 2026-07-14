import { spawnSync } from "node:child_process";

export function selectFolder(initial: string) {
  if (process.env.HARNESS_FOLDER_PICKER_RESULT) return process.env.HARNESS_FOLDER_PICKER_RESULT;
  const result = process.platform === "win32" ? windows(initial)
    : process.platform === "darwin" ? mac()
    : linux(initial);
  if (result.status && result.status !== 0) {
    throw new Error(result.stderr?.trim() || "Folder picker failed");
  }
  return result.stdout?.trim() || null;
}

function windows(initial: string) {
  const script = `
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = 'Choose a workspace folder'
$dialog.ShowNewFolderButton = $true
if (Test-Path $env:CAIRN_INITIAL_FOLDER) { $dialog.SelectedPath = $env:CAIRN_INITIAL_FOLDER }
if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
  [Console]::Out.Write($dialog.SelectedPath)
}`;
  return spawnSync("powershell.exe", ["-NoProfile", "-STA", "-Command", script], {
    encoding: "utf8",
    env: { ...process.env, CAIRN_INITIAL_FOLDER: initial },
    windowsHide: false,
  });
}

function mac() {
  return spawnSync("osascript", ["-e", "POSIX path of (choose folder with prompt \"Choose a workspace folder\")"], { encoding: "utf8" });
}

function linux(initial: string) {
  return spawnSync("zenity", ["--file-selection", "--directory", "--title=Choose a workspace folder", `--filename=${initial}/`], { encoding: "utf8" });
}
