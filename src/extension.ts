import * as vscode from "vscode";
import { commands, Uri } from "vscode";
import { registerFileWatchers } from "./synchronization";
import { startCommandServer } from "./commandServer";

export async function activate(context: vscode.ExtensionContext) {
  // NOTE(pcohen): can be used to debug code reloading issues
  // vscode.window.showInformationMessage("Cursorless sidecar started (v10)!");

  startCommandServer();
  registerFileWatchers();

  // ================================================================================
  // Extra commands (for debugging purposes)
  // ================================================================================

  //
  // Opening file by path
  //
  context.subscriptions.push(
    vscode.commands.registerCommand("sidecar.openPath", (path) => {
      commands.executeCommand("vscode.open", Uri.file(path));
    }),
  );

  //
  // Setting the cursor position(s)
  //
  context.subscriptions.push(
    vscode.commands.registerCommand("sidecar.setCursor", (x, y, z, a) => {
      let editor = vscode.window.activeTextEditor;
      if (editor) {
        // TODO(pcohen): multiple selections
        editor.selections = [new vscode.Selection(x, y, z, a)];
      }
    }),
  );
}

// this method is called when your extension is deactivated
export function deactivate() {}
