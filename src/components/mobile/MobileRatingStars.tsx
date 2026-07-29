import { Star } from "lucide-react";
import { cn } from "../../lib/cn";

/**
 * Touch-sized interactive rating control (44x44 targets, unlike the compact
 * desktop RatingStars). Tapping the current rating clears it to 0. `tone`
 * selects the empty-star color so it stays visible on the dark preview
 * ("dark") and on light sheets ("light").
 */
export function MobileRatingStars({
  rating,
  onChange,
  size = 28,
  tone = "light"
}: {
  rating: number;
  onChange: (rating: number) => void;
  size?: number;
  tone?: "light" | "dark";
}) {
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((value) => {
        const filled = value <= rating;
        return (
          <button
            aria-label={`${value} 星`}
            className="mpw-touch flex h-11 w-11 items-center justify-center"
            key={value}
            onClick={() => onChange(value === rating ? 0 : value)}
            type="button"
          >
            <Star
              className={cn(filled ? "text-yellow-400" : tone === "dark" ? "text-white/35" : "text-slate-300")}
              fill={filled ? "currentColor" : "none"}
              size={size}
            />
          </button>
        );
      })}
    </div>
  );
}
