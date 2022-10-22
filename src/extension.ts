import * as vscode from "vscode";

export async function activate(context: vscode.ExtensionContext) {
  // NOTE(pcohen): can be used to debug code reloading issues
  vscode.window.showErrorMessage("The cursorless sidecar has been deprecated as a separate extension for now; please uninstall it, and install the latest Cursorless (everywhere fork) instead");
}

// this method is called when your extension is deactivated
export function deactivate() {}
