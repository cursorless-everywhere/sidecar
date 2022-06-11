import * as vscode from "vscode";
import { commands, Uri } from "vscode";

export function activate(context: vscode.ExtensionContext) {
  // vscode.window.showInformationMessage("Sidecar Loaded!");

  async function applyJetBrainsState() {
    const fs = require("fs");
    const os = require("os");

    // TODO(pcohen): make this generic across editors
    // TODO(pcohen): diff the state against the previous state
    let state = JSON.parse(
        fs.readFileSync(os.homedir() + "/.jb-state/latest.json")
    );
    let activeEditorState = state["activeEditor"];

    let editor = vscode.window.activeTextEditor;

    if (activeEditorState["path"] !== editor?.document.uri.path) {
      // vscode.window.showInformationMessage("Changing paths to " + state["currentPath"]);

      // TODO(pcohen): we need to make this blocking; I believe the commands below
      // run too early when the currently opened file is changed.
      await commands.executeCommand(
          "vscode.open",
          Uri.file(state["activeEditor"]["path"])
      );

      // Close the other tabs that might have been opened.
      // TODO(pcohen): this seems to always leave one additional tab open.
      await commands.executeCommand("workbench.action.closeOtherEditors");
    }

    commands.executeCommand("revealLine", {
      lineNumber: activeEditorState["firstVisibleLine"] - 1,
      at: "top",
    });

    if (editor) {
      editor.selections = activeEditorState["cursors"].map(
          (cursor: any) =>
              new vscode.Selection(
                  cursor.line,
                  cursor.column,
                  cursor.line,
                  cursor.column
              )
      );
    }
  }

  const watcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(require("os").homedir() + "/.jb-state/", "**/*")
  );

  watcher.onDidChange((uri) => {
    applyJetBrainsState();
  });

  watcher.onDidCreate((uri) => {
    applyJetBrainsState();
  });

  // ================================================================================
  // Extra commands (for debugging purposes)
  // ================================================================================

  //
  // Opening file by path
  //
  context.subscriptions.push(
    vscode.commands.registerCommand("sidecar.openPath", (path) => {
      commands.executeCommand("vscode.open", Uri.file(path));
    })
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
    })
  );
}

// this method is called when your extension is deactivated
export function deactivate() {}
