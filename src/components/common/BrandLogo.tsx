import { appIconUrl } from "../../lib/brand";
import { cn } from "../../lib/cn";

const sizeClass = {
  sm: "h-8 w-8 rounded-lg text-[10px]",
  md: "h-12 w-12 rounded-xl text-sm",
  lg: "h-20 w-20 rounded-2xl text-xl"
};

export function BrandLogo({
  size = "md",
  className,
  imageClassName
}: {
  size?: "sm" | "md" | "lg";
  className?: string;
  imageClassName?: string;
}) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden bg-red-700 text-center font-bold leading-tight text-white shadow-sm",
        sizeClass[size],
        className
      )}
    >
      {appIconUrl ? (
        <img alt="勤信青年" className={cn("h-full w-full object-cover", imageClassName)} src={appIconUrl} />
      ) : (
        <span>
          勤信
          <br />
          青年
        </span>
      )}
    </div>
  );
}

