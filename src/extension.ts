import * as vscode from "vscode";
import { commands, Uri } from "vscode";

export function activate(context: vscode.ExtensionContext) {
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
    let activeEditorState = state["activeEditor"];

    let editor = vscode.window.activeTextEditor;

    // If we got into a state where the editor has local changes, always revert them. Otherwise all subsequent
    // commands will fail.
    //
    // Note that this shouldn't happen ideally. This can happen if chaining is attempted (need to find
    // a better synchronization solution).
    if (editor?.document.isDirty) {
      vscode.window.showInformationMessage("Editor is dirty; reverting first");
      await commands.executeCommand("workbench.action.files.revert");
    }

    let destPath = activeEditorState["path"];

    // TODO(pcohen): forward the language mode from the source editor, rather than just relying on the file extension
    // (see workbench.action.editor.changeLanguageMode, but also, there is a direct
    // API for this: vscode.languages.setLanguageId, and a voice command: "change language Python")

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
      if (activeEditorState["selections"]) {
        editor.selections = activeEditorState["selections"].map(
          (selection: any) => {
            return new vscode.Selection(
              selection.anchor.line,
              selection.anchor.column,
              selection.active.line,
              selection.active.column
            );
          }
        );
      } else {
        // TODO(rntz): migrate to |activeEditorState["selections"]|
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

  function vsCodeState(includeEditorContents: boolean = false) {
    const editor = vscode.window.activeTextEditor;

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

  function serializeVsCodeState(showNotification = false) {
    const fs = require("fs");
    let state = vsCodeState();

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
            // TODO(pcohen): Cursorless may throw errors if the users command wasn't valid,
            // which we need to surface back up to the user
            // for example: "NoContainingScopeError: Couldn't find containing namedFunction."
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
