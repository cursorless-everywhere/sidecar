import * as vscode from "vscode";
import { commands, Uri } from "vscode";
import { registerFileWatchers } from "./synchronization";
import { startCommandServer } from "./commandServer";

export async function activate(context: vscode.ExtensionContext) {
  // NOTE(pcohen): can be used to debug code reloading issues
  // vscode.window.showInformationMessage("Cursorless sidecar started (v10)!");

  startCommandServer();
  registerFileWatchers();
}

// this method is called when your extension is deactivated
export function deactivate() {}
