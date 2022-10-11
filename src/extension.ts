import * as vscode from "vscode";
import { commands, Uri } from "vscode";
import { registerFileWatchers } from "./synchronization";
import { startCommandServer } from "./commandServer";

export async function activate(context: vscode.ExtensionContext) {
  // NOTE(pcohen): can be used to debug code reloading issues
  // vscode.window.showInformationMessage("Cursorless sidecar started (v10)!");

  registerFileWatchers();
  // NOTE(pcohen): this won't behave well if another instance of Code is already serving the socket
  startCommandServer();
}

// this method is called when your extension is deactivated
export function deactivate() {}
