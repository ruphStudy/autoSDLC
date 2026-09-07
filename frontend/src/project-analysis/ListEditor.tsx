import type { ReactNode } from 'react';

interface ListEditorProps<T> {
  title: string;
  items: T[];
  onChange: (items: T[]) => void;
  createItem: () => T;
  renderItem: (item: T, update: (patch: Partial<T>) => void) => ReactNode;
  addLabel?: string;
}

// The one reusable piece behind every section's add/edit/remove controls —
// deliberately just array CRUD chrome. Each section still writes its own
// field markup via `renderItem`, so this stays a small helper rather than a
// generic form-builder.
export function ListEditor<T>({
  title,
  items,
  onChange,
  createItem,
  renderItem,
  addLabel = 'Add item',
}: ListEditorProps<T>) {
  const updateAt = (index: number, patch: Partial<T>) => {
    onChange(items.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  };
  const removeAt = (index: number) => {
    onChange(items.filter((_, i) => i !== index));
  };

  return (
    <fieldset className="analysis-edit-section">
      <legend>{title}</legend>
      {items.length === 0 && <p className="analysis-empty-section">No items yet.</p>}
      {items.map((item, i) => (
        <div key={i} className="analysis-edit-row">
          <div className="analysis-edit-row-fields">{renderItem(item, (patch) => updateAt(i, patch))}</div>
          <button type="button" className="secondary" onClick={() => removeAt(i)}>
            Remove
          </button>
        </div>
      ))}
      <button type="button" className="secondary" onClick={() => onChange([...items, createItem()])}>
        {addLabel}
      </button>
    </fieldset>
  );
}
