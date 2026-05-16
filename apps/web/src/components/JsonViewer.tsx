export function JsonViewer({ value }: { value: unknown }) {
  let text: string;
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    text = JSON.stringify(parsed, null, 2);
  } catch {
    text = typeof value === "string" ? value : JSON.stringify(value);
  }
  return (
    <pre className="max-h-[60vh] overflow-auto rounded bg-slate-900 p-4 text-xs text-green-200">
      {text}
    </pre>
  );
}
