export function FormInput({ label, value, button }: { label: string; value: string; button?: string }) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-slate-500">{label}</label>
      <div className="flex gap-2">
        <input className="flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600" disabled type="text" value={value} />
        {button && <button className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50" type="button">{button}</button>}
      </div>
    </div>
  );
}

export function SelectInput({ label, options }: { label: string; options: string[] }) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-slate-500">{label}</label>
      <select className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none">
        {options.map((option) => <option key={option}>{option}</option>)}
      </select>
    </div>
  );
}

export function Step({ number, label, active, completed }: { number: number; label: string; active: boolean; completed: boolean }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <div className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium transition-colors ${completed || active ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-400"}`}>
        {completed ? "✓" : number}
      </div>
      <span className={`text-xs font-medium ${active ? "text-blue-600" : "text-slate-400"}`}>{label}</span>
    </div>
  );
}
