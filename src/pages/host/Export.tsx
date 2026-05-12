import { Info, UploadCloud } from "lucide-react";
import { FormInput, SelectInput } from "../../components/ui/FormControls";
import { cn } from "../../lib/cn";

export function ExportPage() {
  return (
    <div className="flex h-full flex-1 flex-col overflow-y-auto bg-[#F8F9FA] p-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="mb-1 text-2xl font-bold text-slate-900">导出发布</h1>
          <p className="text-sm text-slate-500">将筛选好的图片导出为发布包</p>
        </div>
      </div>

      <div className="mx-auto flex min-h-0 w-full max-w-5xl flex-1 gap-6">
        <div className="flex h-fit flex-1 flex-col rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
          <h3 className="mb-5 font-medium text-slate-900">导出来源</h3>
          <div className="mb-8 grid grid-cols-2 gap-4">
            <ExportSource active title="当前筛选结果" body="图片墙当前列表中的 1,256 张图片" />
            <ExportSource title="可发布" body="所有标记为“可发布”的图片" />
            <ExportSource title="4 星以上" body="包含所有 4 星及 5 星的图片" />
            <ExportSource title="已修图" body="包含所有状态为“已修图”的图片" />
          </div>

          <h3 className="mb-5 font-medium text-slate-900">导出设置</h3>
          <div className="flex-1 space-y-5">
            <SelectInput label="导出规格" options={["长边 3000px", "长边 1920px", "原尺寸"]} />
            <div className="grid grid-cols-2 gap-4">
              <SelectInput label="图片格式" options={["JPEG"]} />
              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-500">JPEG 质量 (1-100)</label>
                <input className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none" defaultValue="90" type="number" />
              </div>
            </div>
            <SelectInput label="文件命名规则" options={["保持原文件名", "活动名_原文件名", "序列号_原文件名"]} />
            <FormInput label="保存路径" value="D:\Photos\Export\运动会_可发布" button="浏览" />
          </div>
        </div>

        <div className="flex h-fit w-[320px] flex-col rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
          <h3 className="mb-5 font-medium text-slate-900">预估结果</h3>
          <div className="mb-8 space-y-4">
            <PreviewRow label="图片数量" value="1,256 张" />
            <PreviewRow label="预计大小" value="约 3.8 GB" />
            <PreviewRow label="输出目录" value="运动会_可发布" small />
          </div>
          <div className="mb-6 flex gap-3 rounded-xl bg-blue-50 p-4 text-xs leading-relaxed text-blue-800">
            <Info className="shrink-0 text-blue-600" size={16} />
            <p>导出的图片将不会影响原仓库文件。建议导出长边为 3000px 的 JPEG 文件用于网络发布。</p>
          </div>
          <button className="mt-auto flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-6 py-3 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700" type="button">
            <UploadCloud size={18} />
            开始导出
          </button>
        </div>
      </div>
    </div>
  );
}

function ExportSource({ title, body, active = false }: { title: string; body: string; active?: boolean }) {
  return (
    <label className={cn("flex cursor-pointer items-start gap-3 rounded-xl border p-4", active ? "border-blue-500 bg-blue-50" : "border-slate-200 hover:border-slate-300")}>
      <input className="mt-1 text-blue-600 focus:ring-blue-600" defaultChecked={active} name="source" type="radio" />
      <div>
        <p className={cn("text-sm font-medium", active ? "text-blue-900" : "text-slate-900")}>{title}</p>
        <p className={cn("mt-1 text-xs", active ? "text-blue-700" : "text-slate-500")}>{body}</p>
      </div>
    </label>
  );
}

function PreviewRow({ label, value, small = false }: { label: string; value: string; small?: boolean }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-50 py-2">
      <span className="text-sm text-slate-500">{label}</span>
      <span className={cn(small ? "max-w-[150px] truncate text-xs font-medium" : "font-semibold", "text-slate-900")}>{value}</span>
    </div>
  );
}
