import { Star } from "lucide-react";

export function RatingStars({
  rating,
  size = 14,
  interactive = false,
  onChange
}: {
  rating: number;
  size?: number;
  interactive?: boolean;
  onChange?: (rating: number) => void;
}) {
  return (
    <div className="flex items-center gap-1 text-yellow-400">
      {Array.from({ length: 5 }).map((_, index) => {
        const value = index + 1;
        const filled = value <= rating;
        const star = (
          <Star
            className={filled ? "" : "text-slate-200"}
            fill={filled ? "currentColor" : "none"}
            size={size}
          />
        );

        if (!interactive) {
          return <span key={value}>{star}</span>;
        }

        return (
          <button
            className="rounded p-0.5 hover:bg-yellow-50"
            key={value}
            onClick={() => onChange?.(value)}
            title={`${value} 星`}
            type="button"
          >
            {star}
          </button>
        );
      })}
    </div>
  );
}
