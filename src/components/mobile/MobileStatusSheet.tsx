import { Check } from "lucide-react";
import { ImageStatus, imageStatusLabels, imageStatusOptions } from "../../lib/api";
import { cn } from "../../lib/cn";
import { getImageWorkflowStatusSemantic } from "../../lib/statusSemantics";
import { BottomSheet } from "./BottomSheet";

/** Reusable mobile status picker — large touch rows for the 0..N workflow states. */
export function MobileStatusSheet({
  open,
  onClose,
  current,
  onSelect
}: {
  open: boolean;
  onClose: () => void;
  current: ImageStatus;
  onSelect: (status: ImageStatus) => void;
}) {
  return (
    <BottomSheet maxHeightClass="mpw-max-h-70" onClose={onClose} open={open} title="修改状态">
      <div className="space-y-1 pb-4 pt-1">
        {imageStatusOptions.map((status) => {
          const active = status === current;
          return (
            <button
              className={cn(
                "mpw-touch flex h-12 w-full items-center justify-between rounded-xl px-3 text-sm",
                active ? "bg-blue-50 font-medium text-blue-700" : "text-slate-700 active:bg-slate-50"
              )}
              key={status}
              onClick={() => {
                onSelect(status);
                onClose();
              }}
              type="button"
            >
              <span className={cn("inline-block rounded-md border px-2.5 py-1 text-xs font-medium", getImageWorkflowStatusSemantic(status).badgeClass)}>
                {imageStatusLabels[status]}
              </span>
              {active && <Check size={18} className="text-blue-600" />}
            </button>
          );
        })}
      </div>
    </BottomSheet>
  );
}
