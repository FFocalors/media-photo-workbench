import { AlertCircle, CheckCircle2, XCircle } from "lucide-react";
import { useState } from "react";
import { FormInput, SelectInput, Step } from "../../components/ui/FormControls";
import { Notice } from "../../components/ui/States";
import { cn } from "../../lib/cn";

export function ImportPage() {
  const [step] = useState(3);

  return (
    <div className="flex h-full flex-1 flex-col overflow-y-auto bg-[#F8F9FA] p-8">
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">图片导入</h1>
      </div>

      <div className="mx-auto mb-10 flex w-full max-w-2xl items-center justify-center">
        <Step number={1} label="选择来源" active={step >= 1} completed={step > 1} />
        <div className="mx-4 h-px flex-1 bg-slate-200" />
        <Step number={2} label="填写信息" active={step >= 2} completed={step > 2} />
        <div className="mx-4 h-px flex-1 bg-slate-200" />
        <Step number={3} label="导入中" active={step >= 3} completed={step > 3} />
        <div className="mx-4 h-px flex-1 bg-slate-200" />
        <Step number={4} label="完成" active={step >= 4} completed={step > 4} />
      </div>

      <div className="mx-auto flex min-h-0 w-full max-w-5xl flex-1 gap-6">
        <div className="flex flex-1 flex-col rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
          <div className="mb-6 flex border-b border-slate-100">
            <button className="mr-6 border-b-2 border-blue-600 px-1 pb-3 text-sm font-medium text-blue-600" type="button">本地导入</button>
            <button className="mr-6 border-b-2 border-transparent px-1 pb-3 text-sm font-medium text-slate-500 hover:text-slate-700" type="button">客户端上传</button>
            <button className="border-b-2 border-transparent px-1 pb-3 text-sm font-medium text-slate-400" disabled type="button">远程传输 (预留)</button>
          </div>

          <h3 className="mb-5 font-medium text-slate-900">导入设置</h3>

          <div className="flex-1 space-y-5 overflow-y-auto pr-2">
            <FormInput label="源文件夹" value="D:\\Photos\\运动会20260510" button="浏览" />
            <SelectInput label="摄影师" options={["张伟", "李娜"]} />
            <SelectInput label="设备" options={["Canon EOS R5", "Nikon Z6III", "Sony A7R IV"]} />
            <SelectInput label="所属活动" options={["2026 春季运动会"]} />
          </div>

          <div className="mt-6 flex justify-end gap-3 border-t border-slate-100 pt-6">
            <button className="rounded-lg border border-slate-200 bg-white px-6 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50" type="button">取消</button>
            <button className="cursor-not-allowed rounded-lg bg-slate-300 px-6 py-2 text-sm font-medium text-white" disabled type="button">导入中</button>
          </div>
        </div>

        <div className="flex w-[400px] flex-col rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
          <div className="mb-6 flex items-center justify-between">
            <h3 className="font-medium text-slate-900">
              导入进度 <span className="ml-1 text-sm font-normal text-slate-400">(正在导入...)</span>
            </h3>
          </div>

          <div className="mb-8">
            <div className="mb-3 text-4xl font-bold text-slate-900">68<span className="text-2xl">%</span></div>
            <div className="mb-3 h-2 w-full overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-blue-600" style={{ width: "68%" }} />
            </div>
            <p className="text-sm text-slate-500">已处理 12,846 / 18,732 张</p>
          </div>

          <div className="mb-8 space-y-4">
            <ProgressRow color="text-emerald-600" icon={<CheckCircle2 size={16} />} label="成功" value="12,253" />
            <ProgressRow color="text-red-500" icon={<XCircle size={16} />} label="失败" value="178" />
            <ProgressRow color="text-slate-400" icon={<AlertCircle size={16} />} label="跳过" value="415" />
          </div>

          <Notice tone="warning" title="失败记录已保留">
            失败 178 张、跳过 415 张。失败文件会进入任务详情，支持后续按文件名和失败原因重试。
          </Notice>

          <div className="mt-auto flex justify-end pt-4">
            <button className="text-sm font-medium text-blue-600 hover:text-blue-700" type="button">查看失败文件</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ProgressRow({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string; color: string }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-50 py-2">
      <div className={cn("flex items-center gap-2", color)}>
        {icon}
        <span className="text-sm font-medium">{label}</span>
      </div>
      <span className="font-semibold text-slate-900">{value}</span>
    </div>
  );
}
