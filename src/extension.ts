import * as vscode from "vscode";
import { property, map, indexOf, zipObject,keys } from "lodash";
import { commands, Uri } from "vscode";


const columnFocusCommands = {
  [vscode.ViewColumn.One]: "workbench.action.focusFirstEditorGroup",
  [vscode.ViewColumn.Two]: "workbench.action.focusSecondEditorGroup",
  [vscode.ViewColumn.Three]: "workbench.action.focusThirdEditorGroup",
  [vscode.ViewColumn.Four]: "workbench.action.focusFourthEditorGroup",
  [vscode.ViewColumn.Five]: "workbench.action.focusFifthEditorGroup",
  [vscode.ViewColumn.Six]: "workbench.action.focusSixthEditorGroup",
  [vscode.ViewColumn.Seven]: "workbench.action.focusSeventhEditorGroup",
  [vscode.ViewColumn.Eight]: "workbench.action.focusEighthEditorGroup",
  [vscode.ViewColumn.Nine]: "workbench.action.focusNinthEditorGroup",
  [vscode.ViewColumn.Active]: "",
  [vscode.ViewColumn.Beside]: "",
};

export async function focusEditor(editor: vscode.TextEditor) {
  const viewColumn = getViewColumn(editor);
  if (viewColumn != null) {
    await commands.executeCommand(columnFocusCommands[viewColumn]);
  }
}

function getViewColumn(editor: vscode.TextEditor): vscode.ViewColumn | undefined {
  if (editor.viewColumn != null) {
    return editor.viewColumn;
  }
}

export async function activate(context: vscode.ExtensionContext) {
  // ================================================================================
  // Applying the the primary/other editor's state
  // ================================================================================

  /**
   * Supports reading a "feature flag", which is just a local file with boolean value.
   */
  function readFlagFile(path: string, defaultValue: boolean): boolean {
    const fs = require("fs");

    if (!fs.existsSync(path)) {
      return defaultValue;
    }

    try {
      const contents = fs.readFileSync(path, "utf8").trim().toLowerCase();
      switch (contents) {
        case "true":
          return true;
        case "false":
          return false;
        default:
          return defaultValue;
      }
    } catch (e) {
      return defaultValue;
    }
  }

  /**
   * Reads the state of the primary ("superior") editor and makes VS Code mimic it
   * (current file, selections, scroll area, etc.)
   */
  async function applyEditorStateToVscodeEditor(
    editorState: any,
    editor: vscode.TextEditor
  ) {
    // If we got into a state where the editor has local changes, always revert them. Otherwise all subsequent
    // commands will fail.
    //
    // Note that this shouldn't happen ideally. This can happen if chaining is attempted (need to find
    // a better synchronization solution).
    if (editor?.document.isDirty) {
      vscode.window.showInformationMessage("Editor is dirty; reverting first");
      await commands.executeCommand("workbench.action.files.revert");
    }

    let destPath = editorState["path"];

    // TODO(pcohen): forward the language mode from the source editor, rather than just relying on the file extension
    // (see workbench.action.editor.changeLanguageMode, but also, there is a direct
    // API for this: vscode.languages.setLanguageId, and a voice command: "change language Python")

    // Prefer the temporary file if it's available
    if (editorState["temporaryFilePath"]) {
      destPath = editorState["temporaryFilePath"];
    }

    if (destPath !== editor?.document.uri.path) {
      // vscode.window.showInformationMessage("Changing paths to " + state["currentPath"]);

      // TODO(pcohen): we need to make this blocking; I believe the commands below
      // run too early when the currently opened file is changed.
      await commands.executeCommand("vscode.open", Uri.file(destPath));
    }

    if (editor) {
      if (editorState["selections"]) {
        editor.selections = editorState["selections"].map((selection: any) => {
          return new vscode.Selection(
            selection.anchor.line,
            selection.anchor.column,
            selection.active.line,
            selection.active.column
          );
        });
      } else {
        // TODO(rntz): migrate to |editorState["selections"]|
        editor.selections = editorState["cursors"].map(
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
  }

  async function applyPrimaryEditorState() {
    const fs = require("fs");
    const os = require("os");
    const path = require("path");

    const SIDECAR_FEATURE_FLAG_PATH = path.join(
      os.homedir(),
      ".cursorless/sidecar-enabled"
    );

    // Allowed disabling the sidecar with a flag, so you can actually use other parts of VS Code
    // when needed.
    if (!readFlagFile(SIDECAR_FEATURE_FLAG_PATH, true)) {
      console.log(
        `applyPrimaryEditorState: ${SIDECAR_FEATURE_FLAG_PATH} set to false; not synchronizing`
      );
      return;
    }

    // TODO(pcohen): make this generic across editors
    // TODO(pcohen): diff the state against the previous state
    let state = JSON.parse(
      fs.readFileSync(os.homedir() + "/.cursorless/editor-state.json")
    );

    // map tempfilepath to vscode editor (eventually id to vscode editor)
    const editorMap = zipObject(
      map(vscode.window.visibleTextEditors, property("document.fileName")),
      vscode.window.visibleTextEditors
    );

    let differentVisibleWindows = false;
    let superiorEditorVisibleFileNames = map(
      state["editors"],
      property("temporaryFilePath")
    );

    superiorEditorVisibleFileNames.forEach((superiorEditorFileName) => {
      if (keys(editorMap).indexOf(superiorEditorFileName) === -1) {
        differentVisibleWindows = true;
      }
    });

    let activeEditor;

    if (differentVisibleWindows) {
      // Close the other tabs that might have been opened.
      // TODO(pcohen): this seems to always leave one additional tab open.
      await commands.executeCommand("workbench.action.closeAllEditors");

      state["editors"].forEach(async (editorState: any) => {
        let vscodeEditor = await vscode.window.showTextDocument(
          Uri.file(editorState["temporaryFilePath"]),
          {
            viewColumn: vscode.ViewColumn.Beside,
          }
        );




        if (editorState["active"] === true) {
          activeEditor = vscodeEditor;
        }

        await applyEditorStateToVscodeEditor(editorState, vscodeEditor);
      });
    } else {
      state["editors"].forEach(async (editorState: any) => {
        if (editorState["active"] === true) {
          activeEditor = editorMap[editorState["temporaryFilePath"]];
        }
        await applyEditorStateToVscodeEditor(
          editorState,
          editorMap[editorState["temporaryFilePath"]]
        );
      });
    }

    await focusEditor(activeEditor);

  }

  const watcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(
      require("os").homedir() + "/.cursorless/",
      "*-state.json"
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

  function vsCodeState(includeEditorContents: boolean = false) {
    return {
      editors: map(vscode.window.visibleTextEditors, (textEditor) => {
        return vsCodeEditorState(textEditor, includeEditorContents);
      })
    }
  }

  function vsCodeEditorState(editor: vscode.TextEditor, includeEditorContents: boolean = false) {
    let result = {
      path: editor?.document.uri.path,
      cursors: editor?.selections.map((s) => {
        return {
          anchor: {
            line: s.anchor.line,
            character: s.anchor.character,
          },
          active: {
            line: s.active.line,
            character: s.active.character,
          },
          // NOTE(pcohen): these are included just for ease of implementation;
          // obviously the receiving end could which of the anchor/active is the start/end
          start: {
            line: s.start.line,
            character: s.start.character,
          },
          end: {
            line: s.end.line,
            character: s.end.character,
          },
        };
      }),
    };

    if (includeEditorContents) {
      const fs = require("fs");
      // For simplicity will just write to the active path + ".out",
      // assuming the active path is a temporary file.
      const contentsPath = `${result.path}.out`;
      fs.writeFileSync(contentsPath, editor?.document.getText());
      // @ts-ignore
      result["contentsPath"] = contentsPath;
    }

    return result;
  }

  // ================================================================================
  // Control socket
  // ================================================================================

  /**
   * Handles a request from the control socket in returns the response.
   *
   * One useful way to test this is with `socat`:
   *     echo '{ "command": "state" }' | socat - ~/.cursorless/vscode-socket | jq .
   */
  async function handleRequest(requestObj: any) {
    /** Runs a VS Code command with arguments */
    async function runVSCodeCommand(requestObj: any) {
      const args = requestObj.commandArgs || [];
      const result = await vscode.commands.executeCommand(
        requestObj.commandId,
        ...args
      );
      return { result: result };
    }

    try {
      switch (requestObj.command) {
        case "ping":
          return { response: "pong" };
        case "state":
          return vsCodeState();
        case "stateWithContents":
          return vsCodeState(true);
        case "applyPrimaryEditorState":
          // TODO(pcohen): this may change the editor state,
          // but it doesn't actually block on Cursorless applying those changes
          applyPrimaryEditorState();
          return "OK";
        case "command":
          return { result: await runVSCodeCommand(requestObj) };
        case "cursorless":
          // NOTE(pcohen): this need not be Cursorless specific; perhaps a better command name might be
          // along the lines of "execute command and serialize state"

          // NOTE(pcohen): this is wrapped as JSON mostly to simplify stuff on the Kotlin sighed
          const cursorlessArgs = JSON.parse(requestObj.cursorlessArgs);

          const oldState = vsCodeState();

          try {
            const commandResult = await vscode.commands.executeCommand(
              "cursorless.command",
              ...cursorlessArgs
            );
            const newState = vsCodeState(true);
            return {
              oldState: oldState,
              commandResult: JSON.stringify(commandResult),
              newState: newState,
            };
          } catch (e) {
            return {
              commandException: `${e}`,
            };
          }
        case "pid":
          return `${require("process").pid}`;
        default:
          return { error: `invalid command: ${requestObj.command}` };
      }
    } catch (e) {
      vscode.window.showInformationMessage(
        `Error during evaluation of command "${requestObj.command}": ${e}`
      );
      return { error: `exception during execution: ${e}` };
    }
  }

  try {
    const net = require("net");
    const fs = require("fs");
    const os = require("os");

    const socketPath = os.homedir() + "/.cursorless/vscode-socket";

    try {
      // make sure the file is deleted first.
      fs.unlinkSync(socketPath);
    } catch (e) {}

    const unixSocketServer = net.createServer();
    unixSocketServer.listen(socketPath, () => {
      console.log("Control socket is now listening");
    });

    unixSocketServer.on("connection", (s: any) => {
      s.on("data", async (msg: any) => {
        // TODO(pcohen): build up a string buffer until we get to a new line, then try to parse it
        // since we can't guarantee that the entire message will be received in one chunk
        const inputString = msg.toString();
        const request = JSON.parse(inputString);
        const response = await handleRequest(request);
        s.write(JSON.stringify(response));
        s.end();
      });
      // s.end();
    });
  } catch (e) {
    vscode.window.showInformationMessage(
      `Error setting up control socket: ${e}`
    );
  }

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
