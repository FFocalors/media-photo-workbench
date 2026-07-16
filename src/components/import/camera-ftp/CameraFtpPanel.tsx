import type { ReactNode } from "react";

export function CameraFtpPanel({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm sm:p-6">
      <div className="mb-5 flex items-center gap-2 text-slate-900">
        <span className="text-blue-600">{icon}</span>
        <h3 className="font-semibold">{title}</h3>
      </div>
      {children}
    </section>
  );
}
