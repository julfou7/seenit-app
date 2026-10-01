export interface DialogEntry {
  id: string;
  depth: number;
  close: () => void;
}

// Les enfants passent avant leurs parents, même si React monte leurs effets en premier.
export function createDialogStack() {
  const entries: DialogEntry[] = [];
  let closing: string | null = null;
  const top = () => entries.reduce<DialogEntry | undefined>((current, entry) =>
    !current || entry.depth >= current.depth ? entry : current, undefined);
  return {
    top,
    entries: () => [...entries],
    add(entry: DialogEntry) {
      entries.push(entry);
      return () => {
        const index = entries.indexOf(entry);
        if (index >= 0) entries.splice(index, 1);
        if (closing === entry.id) closing = null;
      };
    },
    closeTop() {
      const entry = top();
      if (!entry) return false;
      if (closing !== entry.id) {
        closing = entry.id;
        entry.close();
      }
      return true;
    },
    acknowledge(id: string) {
      if (closing === id) closing = null;
    },
  };
}

export const dialogStack = createDialogStack();
export const closeTopDialog = () => dialogStack.closeTop();

export function closeTabSubview(tab: string) {
  return !window.dispatchEvent(new CustomEvent(`${tab}-back-one-level`, { cancelable: true }));
}
