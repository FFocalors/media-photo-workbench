import { Download, Info, UploadCloud } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { cn } from "../../lib/cn";

export function RetouchPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const tab = location.pathname.includes("done") ? "done" : "todo";

  return (
    <div className="flex h-full flex-1 flex-col overflow-y-auto bg-[#F8F9FA] p-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">修图流转</h1>
      </div>

      <div className="mb-6 flex border-b border-slate-200">
        <button
          className={cn("border-b-2 px-4 pb-3 text-sm font-medium transition-colors", tab === "todo" ? "border-blue-600 text-blue-600" : "border-transparent text-slate-500 hover:text-slate-700")}
          onClick={() => navigate("/host/retouch")}
          type="button"
        >
          待修图 (1,256)
        </button>
        <button
          className={cn("border-b-2 px-4 pb-3 text-sm font-medium transition-colors", tab === "done" ? "border-blue-600 text-blue-600" : "border-transparent text-slate-500 hover:text-slate-700")}
          onClick={() => navigate("/host/done")}
          type="button"
        >
          已修图 (7,642)
        </button>
      </div>

      {tab === "todo" ? <RetouchTodo /> : <RetouchDone />}
    </div>
  );
}

function RetouchTodo() {
  return (
    <div className="flex min-h-[500px] h-fit flex-1 flex-col rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h3 className="font-medium text-slate-900">待修图管理</h3>
          <p className="mt-1 text-xs text-slate-500">当前有 1,256 张图片被标记为“待修图”</p>
        </div>
        <div className="flex gap-3">
          <button className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50" type="button">生成修图清单</button>
          <button className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700" type="button">
            <Download size={16} />
            下载待修包
          </button>
        </div>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center rounded-xl border border-slate-100 bg-slate-50 p-8 text-slate-400">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-white shadow-sm">
          <Download className="text-blue-500" size={28} />
        </div>
        <p className="text-sm font-medium text-slate-600">点击上方按钮打包下载待修图片原图</p>
        <p className="mt-2 text-xs text-slate-400">支持断点续传和增量下载</p>
      </div>
    </div>
  );
}

function RetouchDone() {
  return (
    <div className="flex min-h-[500px] h-fit flex-1 flex-col rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h3 className="font-medium text-slate-900">已修图管理</h3>
          <p className="mt-1 text-xs text-slate-500">上传已处理好的图片，系统将自动通过文件名关联原图</p>
        </div>
        <button className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700" type="button">
          <UploadCloud size={16} />
          上传已修图
        </button>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-slate-100 bg-slate-50 p-8 text-slate-400">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-white shadow-sm">
          <UploadCloud className="text-blue-500" size={28} />
        </div>
        <p className="text-sm font-medium text-slate-600">拖拽文件夹至此处或点击上方按钮上传</p>
        <p className="mt-2 text-xs text-slate-400">支持 JPG 格式文件</p>
      </div>

      <div className="mt-6 flex items-center justify-between border-t border-slate-100 pt-4 text-sm">
        <div className="flex items-center gap-2 text-slate-600">
          <Info className="text-blue-500" size={16} />
          <span>edit_manifest.json 状态正常</span>
        </div>
        <div className="flex items-center gap-6">
          <span className="font-medium text-emerald-600">已匹配 7,642 张</span>
          <span className="font-medium text-amber-600">未匹配 12 张</span>
          <button className="text-blue-600 hover:underline" type="button">查看错误记录</button>
        </div>
      </div>
    </div>
  );
}
