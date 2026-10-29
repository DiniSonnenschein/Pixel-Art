// Rückgängig/Wiederherstellen. Jeder Eintrag kennt sein eigenes undo()/redo().

const LIMIT = 200;

export class History {
  constructor(onChange) {
    this.undoStack = [];
    this.redoStack = [];
    this.onChange = onChange;
  }

  push(entry) {
    this.undoStack.push(entry);
    if (this.undoStack.length > LIMIT) this.undoStack.shift();
    this.redoStack.length = 0;
    this.onChange();
  }

  undo() {
    const entry = this.undoStack.pop();
    if (!entry) return;
    entry.undo();
    this.redoStack.push(entry);
    this.onChange();
  }

  redo() {
    const entry = this.redoStack.pop();
    if (!entry) return;
    entry.redo();
    this.undoStack.push(entry);
    this.onChange();
  }

  clear() {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.onChange();
  }

  get canUndo() {
    return this.undoStack.length > 0;
  }

  get canRedo() {
    return this.redoStack.length > 0;
  }
}

/** Eintrag für geänderte Pixel einer Ebene (z. B. ein Pinselstrich). */
export function pixelEntry(layer, indices, before, after) {
  const apply = (values) => {
    const px = new Uint32Array(layer.data.buffer);
    for (let i = 0; i < indices.length; i++) px[indices[i]] = values[i];
  };
  return { undo: () => apply(before), redo: () => apply(after) };
}
