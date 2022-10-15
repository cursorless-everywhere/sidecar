import * as vscode from "vscode";
import { commands, Uri } from "vscode";

import { FEATURE_FLAG_ENABLED, readFlagFile } from "./featureFlags";

import * as fs from "fs";
import { CURSORLESS_ROOT_DIRECTORY } from "./constants";
import * as path from "path";
import { keys, map, property, zipObject } from "lodash";

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

function getViewColumn(
  editor: vscode.TextEditor,
): vscode.ViewColumn | undefined {
  if (editor.viewColumn != null) {
    return editor.viewColumn;
  }
}

async function applyEditorStateToVscodeEditor(
  editorState: any,
  editor: vscode.TextEditor,
) {
  // If we got into a state where the editor has local changes, always revert them. Otherwise all subsequent
  // commands will fail.
  //
  // Note that this shouldn't happen ideally. This can happen if chaining is attempted (need to find
  // a better synchronization solution).
  if (editor?.document.isDirty) {
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
          selection.active.column,
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
            cursor.column,
          ),
      );
    }
  }
}

// ================================================================================
// Applying the the primary/other editor's state
// ================================================================================

/**
 * Reads the state of the primary ("superior") editor and makes VS Code mimic it
 * (current file, selections, scroll area, etc.)
 */
export async function applyPrimaryEditorState() {
  if (!readFlagFile(FEATURE_FLAG_ENABLED, true)) {
    console.log(
      `applyPrimaryEditorState: ${FEATURE_FLAG_ENABLED} set to false; not synchronizing`,
    );
    return;
  }

  // TODO(pcohen): diff the state against the previous state
  let state = JSON.parse(
    fs.readFileSync(
      path.join(CURSORLESS_ROOT_DIRECTORY, "editor-state.json"),
      "utf8",
    ),
  );

  // map tempfilepath to vscode editor (eventually id to vscode editor)
  const editorMap = zipObject(
    map(vscode.window.visibleTextEditors, property("document.fileName")),
    vscode.window.visibleTextEditors,
  );

  let differentVisibleWindows = false;
  let superiorEditorVisibleFileNames = map(
    state["editors"],
    property("temporaryFilePath"),
  ) as string[];

  superiorEditorVisibleFileNames.forEach((superiorEditorFileName: string) => {
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
        },
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
        editorMap[editorState["temporaryFilePath"]],
      );
    });
  }

  if (activeEditor) {
    await focusEditor(activeEditor);
  }
}

// ================================================================================
// Serializing VSCode's state
// ================================================================================

export function vsCodeState(includeEditorContents: boolean = false) {
  const editor = vscode.window.activeTextEditor;

  let result = {
    path: editor?.document.uri.path,
    contentsPath: null as string | null,
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
    // For simplicity will just write to the active path + ".out",
    // assuming the active path is a temporary file.
    const contentsPath = `${result.path}.out`;
    const contents = editor?.document.getText();
    if (contents) {
      fs.writeFileSync(contentsPath, contents);
      result["contentsPath"] = contentsPath;
    }
  }

  return result;
}

/**
 * Registers file watchers so that when the exterior editor changes it state, we update VS Code.
 */
export function registerFileWatchers() {
  const watcher = vscode.workspace.createFileSystemWatcher(
    // NOTE(pcohen): we only want to watch editor-state.json but for some reason the watcher doesn't take a exact path
    new vscode.RelativePattern(CURSORLESS_ROOT_DIRECTORY, "*-state.json"),
  );

  watcher.onDidChange((uri) => {
    applyPrimaryEditorState();
  });

  watcher.onDidCreate((uri) => {
    applyPrimaryEditorState();
  });

  applyPrimaryEditorState();
}
