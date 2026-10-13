import { useLayoutEffect, useRef } from "react";
import {
  isEditableShortcutTarget,
  resolveWorkspaceShortcut,
  type WorkspaceShortcut,
} from "@/features/chat/lib/workspace-shortcuts";

/**
 * Global workspace keyboard shortcuts. `handle` returns false when the
 * shortcut does not apply in the current state so the browser keeps the key.
 * Shortcuts are ignored while `blocked` (a modal surface owns the keyboard).
 */
export function useWorkspaceShortcutHandler(
  blocked: boolean,
  handle: (shortcut: WorkspaceShortcut) => boolean,
) {
  const latest = useRef({ blocked, handle });
  latest.current = { blocked, handle };

  // Layout effect: the listener exists before the first paint of the
  // workspace, so a shortcut pressed as soon as it is visible is never lost.
  useLayoutEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const shortcut = resolveWorkspaceShortcut(event, isEditableShortcutTarget(event.target));
      if (!shortcut || latest.current.blocked) return;
      if (latest.current.handle(shortcut)) event.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
