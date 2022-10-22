import * as path from "path";
import * as os from "os";
import * as vscode from "vscode";

/**
 * The directory where we store everything for Cursorless Everywhere related things.
 */
export const CURSORLESS_ROOT_DIRECTORY = path.join(os.homedir(), ".cursorless");

export const CURSORLESS_PREFIX = process.env.CURSORLESS_PREFIX || "";

if (CURSORLESS_PREFIX) {
  vscode.window.showInformationMessage(
    `Cursorless sidecar using filename prefix: ${CURSORLESS_PREFIX}`,
  );
}
