import * as vscode from "vscode";
import { commands, Uri } from "vscode";

export function activate(context: vscode.ExtensionContext) {
  vscode.window.showInformationMessage("Sidecar Loaded!");

  // ================================================================================
  // Applying the the primary/other editor's state
  // ================================================================================

  async function applyPrimaryEditorState() {
    const fs = require("fs");
    const os = require("os");

    // TODO(pcohen): make this generic across editors
    // TODO(pcohen): diff the state against the previous state
    let state = JSON.parse(
      fs.readFileSync(os.homedir() + "/.cursorless/editor-state.json")
    );
    let activeEditorState = state["activeEditor"];

    let editor = vscode.window.activeTextEditor;

    let destPath = activeEditorState["path"];

    // Prefer the temporary file if it's available
    if (activeEditorState["temporaryFilePath"]) {
      destPath = activeEditorState["temporaryFilePath"];
    }

    if (destPath !== editor?.document.uri.path) {
      // vscode.window.showInformationMessage("Changing paths to " + state["currentPath"]);

      // TODO(pcohen): we need to make this blocking; I believe the commands below
      // run too early when the currently opened file is changed.
      await commands.executeCommand("vscode.open", Uri.file(destPath));

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
    new vscode.RelativePattern(
      require("os").homedir() + "/.cursorless/",
      "**/*"
    )
  );

  watcher.onDidChange((uri) => {
    applyPrimaryEditorState();
  });

  watcher.onDidCreate((uri) => {
    applyPrimaryEditorState();
  });

  applyPrimaryEditorState();

  // ================================================================================
  // Serializing VSCode's state
  // ================================================================================

  function serializeVsCodeState(showNotification = false) {
    const fs = require("fs");

    const editor = vscode.window.activeTextEditor;

    let state = {
      path: editor?.document.uri.path,
      cursors: editor?.selections.map((s) => {
        return {
          anchor: {
            line: s.anchor.line,
            character: s.anchor.character,
          },
          end: {
            line: s.end.line,
            character: s.end.character,
          },
        };
      }),
    };

    if (showNotification) {
      vscode.window.showInformationMessage(
        "Wrote state: " + JSON.stringify(state)
      );
    }

    fs.writeFileSync(
      require("os").homedir() + "/.cursorless/vscode-state.json",
      JSON.stringify(state)
    );
  }

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "sidecar.serializeState",
      (showNotification = false) => {
        serializeVsCodeState(showNotification);
        return "OK";
      }
    )
  );

  serializeVsCodeState();

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
