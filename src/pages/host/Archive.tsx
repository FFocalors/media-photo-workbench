import { Archive as ArchiveIcon } from "lucide-react";
import { useState } from "react";
import { FormInput, Step } from "../../components/ui/FormControls";
import { Notice } from "../../components/ui/States";
import { cn } from "../../lib/cn";

export function ArchivePage() {
  const [step, setStep] = useState(1);
  const actionLabel = step === 1 ? "生成归档 mock" : step === 2 ? "验证归档 mock" : step === 3 ? "清理工作区 mock" : "归档完成";

  return (
    <div className="flex h-full flex-1 flex-col overflow-y-auto bg-[#F8F9FA] p-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="mb-1 text-2xl font-bold text-slate-900">活动归档</h1>
          <p className="text-sm text-slate-500">2026 春季运动会</p>
        </div>
      </div>

      <div className="mx-auto mb-10 flex w-full max-w-3xl items-center justify-center">
        <Step number={1} label="生成归档" active={step >= 1} completed={step > 1} />
        <div className="mx-4 h-px flex-1 bg-slate-200" />
        <Step number={2} label="验证归档" active={step >= 2} completed={step > 2} />
        <div className="mx-4 h-px flex-1 bg-slate-200" />
        <Step number={3} label="清理工作区" active={step >= 3} completed={step > 3} />
        <div className="mx-4 h-px flex-1 bg-slate-200" />
        <Step number={4} label="完成" active={step >= 4} completed={step > 4} />
      </div>

      <div className="mx-auto flex min-h-0 w-full max-w-4xl flex-1 gap-6">
        <div className="flex h-fit w-[300px] flex-col rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
          <h3 className="mb-5 font-medium text-slate-900">待归档内容</h3>
          <div className="space-y-4">
            <ArchiveItem label="原图" size="45.2 GB" count="18,732 张" />
            <ArchiveItem label="已修图" size="12.5 GB" count="7,642 张" />
            <ArchiveItem label="发布图" size="4.2 GB" count="12,840 张" />
            <div className="my-2 h-px bg-slate-50" />
            <ArchiveItem label="event.db" size="128 MB" />
            <ArchiveItem label="images.csv" size="15 MB" />
            <ArchiveItem label="manifest.json" size="2 MB" />
          </div>
          <div className="mt-6 border-t border-slate-100 pt-4">
            <div className="flex items-end justify-between">
              <span className="text-sm text-slate-500">预估总体积</span>
              <span className="text-xl font-bold text-slate-900">62.0 GB</span>
            </div>
          </div>
        </div>

        <div className="flex flex-1 flex-col rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
          <h3 className="mb-5 font-medium text-slate-900">归档设置</h3>
          <div className="flex-1 space-y-6">
            <FormInput label="归档路径" value="Z:\\Archive\\2026\\Sports" button="更改" />
            <div>
              <label className="mb-3 block text-sm font-medium text-slate-700">包含内容</label>
              <div className="space-y-3">
                <ArchiveCheck checked label="保留缩略图 (推荐)" note="约 2.5 GB" />
                <ArchiveCheck label="保留预览图" note="约 8.4 GB" />
                <ArchiveCheck label="保留标记为废片的图片" note="345 张" />
              </div>
            </div>

            {step < 3 ? (
              <Notice tone="warning" title="清理工作区暂未开放">
                归档过程会生成文件校验和。只有在归档完成并通过完整性验证后，系统才允许清理当前活动的工作区数据。
              </Notice>
            ) : (
              <Notice tone="success" title="归档校验通过">
                文件数量与 manifest 记录一致，可以执行清理工作区 mock 流程。
              </Notice>
            )}
          </div>

          <div className="mt-6 flex justify-end border-t border-slate-100 pt-6">
            <button
              className={cn(
                "flex items-center gap-2 rounded-lg px-6 py-2.5 text-sm font-medium text-white shadow-sm transition-colors",
                step >= 4 ? "cursor-not-allowed bg-slate-300" : "bg-blue-600 hover:bg-blue-700"
              )}
              disabled={step >= 4}
              onClick={() => setStep((value) => Math.min(value + 1, 4))}
              type="button"
            >
              <ArchiveIcon size={16} />
              {actionLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ArchiveItem({ label, size, count }: { label: string; size: string; count?: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-slate-700">{label}</span>
      <div className="flex items-center gap-3">
        {count && <span className="text-xs text-slate-400">{count}</span>}
        <span className="w-16 text-right font-medium text-slate-900">{size}</span>
      </div>
    </div>
  );
}

function ArchiveCheck({ label, note, checked = false }: { label: string; note: string; checked?: boolean }) {
  return (
    <label className="flex items-center gap-3 text-sm text-slate-700">
      <input className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-600" defaultChecked={checked} type="checkbox" />
      {label}
      <span className="ml-auto text-xs text-slate-400">{note}</span>
    </label>
  );
}
