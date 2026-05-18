import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { cn } from "../../lib/cn";

type QrCell = {
  x: number;
  y: number;
};

function parseViewBoxSize(viewBox: string | null): number {
  if (!viewBox) return 0;
  const parts = viewBox.split(/\s+/).map(Number);
  return Number.isFinite(parts[2]) ? parts[2] : 0;
}

function parseQrCells(pathData: string | null): QrCell[] {
  if (!pathData) return [];
  const cells: QrCell[] = [];
  const matcher = /M([\d.]+)[,\s]+([\d.]+)\s*h([\d.]+)v1H[\d.]+z/g;
  let match: RegExpExecArray | null;

  while ((match = matcher.exec(pathData)) !== null) {
    const x = Number(match[1]);
    const y = Number(match[2]);
    const width = Number(match[3]);

    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(width)) continue;
    for (let index = 0; index < width; index += 1) {
      cells.push({ x: x + index, y });
    }
  }

  return cells;
}

function toCellKey(x: number, y: number): string {
  return `${x}:${y}`;
}

function isFinderPatternCell(cell: QrCell, viewBoxSize: number): boolean {
  if (!viewBoxSize) return false;
  const margin = 2;
  const finderStarts = [
    { x: margin, y: margin },
    { x: viewBoxSize - margin - 7, y: margin },
    { x: margin, y: viewBoxSize - margin - 7 }
  ];

  return finderStarts.some((start) => cell.x >= start.x && cell.x < start.x + 7 && cell.y >= start.y && cell.y < start.y + 7);
}

function buildSmoothModulePath(cell: QrCell, cellSet: Set<string>): string {
  const { x, y } = cell;
  const radius = 0.32;
  const x1 = x + 1;
  const y1 = y + 1;
  const hasTop = cellSet.has(toCellKey(x, y - 1));
  const hasRight = cellSet.has(toCellKey(x + 1, y));
  const hasBottom = cellSet.has(toCellKey(x, y + 1));
  const hasLeft = cellSet.has(toCellKey(x - 1, y));
  const roundTopLeft = !hasTop && !hasLeft;
  const roundTopRight = !hasTop && !hasRight;
  const roundBottomRight = !hasBottom && !hasRight;
  const roundBottomLeft = !hasBottom && !hasLeft;

  return [
    `M${x + (roundTopLeft ? radius : 0)} ${y}`,
    `H${x1 - (roundTopRight ? radius : 0)}`,
    roundTopRight ? `Q${x1} ${y} ${x1} ${y + radius}` : `L${x1} ${y}`,
    `V${y1 - (roundBottomRight ? radius : 0)}`,
    roundBottomRight ? `Q${x1} ${y1} ${x1 - radius} ${y1}` : `L${x1} ${y1}`,
    `H${x + (roundBottomLeft ? radius : 0)}`,
    roundBottomLeft ? `Q${x} ${y1} ${x} ${y1 - radius}` : `L${x} ${y1}`,
    `V${y + (roundTopLeft ? radius : 0)}`,
    roundTopLeft ? `Q${x} ${y} ${x + radius} ${y}` : `L${x} ${y}`,
    "Z"
  ].join("");
}

function renderFinderPattern(x: number, y: number) {
  return (
    <g key={`${x}-${y}`}>
      <rect fill="#111827" height="7" rx="1.1" ry="1.1" width="7" x={x} y={y} />
      <rect fill="#ffffff" height="5" rx="0.82" ry="0.82" width="5" x={x + 1} y={y + 1} />
      <rect fill="#111827" height="3" rx="0.48" ry="0.48" width="3" x={x + 2} y={y + 2} />
    </g>
  );
}

export function RoundedQRCode({
  value,
  size = 128,
  logoSrc,
  className
}: {
  value: string;
  size?: number;
  logoSrc?: string;
  className?: string;
}) {
  const hiddenQrRef = useRef<SVGSVGElement | null>(null);
  const logoClipId = useId().replace(/:/g, "");
  const [cells, setCells] = useState<QrCell[]>([]);
  const [viewBoxSize, setViewBoxSize] = useState(0);

  const imageSettings = useMemo(() => {
    if (!logoSrc) return undefined;
    const logoSize = size * 0.2;
    return {
      src: logoSrc,
      height: logoSize,
      width: logoSize,
      excavate: true
    };
  }, [logoSrc, size]);

  useLayoutEffect(() => {
    const svg = hiddenQrRef.current;
    const paths = svg?.querySelectorAll("path");
    const foregroundPath = paths?.[1]?.getAttribute("d") ?? null;

    setCells(parseQrCells(foregroundPath));
    setViewBoxSize(parseViewBoxSize(svg?.getAttribute("viewBox") ?? null));
  }, [value, size, imageSettings]);

  const foregroundPath = useMemo(() => {
    const drawableCells = cells.filter((cell) => !isFinderPatternCell(cell, viewBoxSize));
    const cellSet = new Set(drawableCells.map((cell) => toCellKey(cell.x, cell.y)));
    return drawableCells.map((cell) => buildSmoothModulePath(cell, cellSet)).join("");
  }, [cells, viewBoxSize]);
  const finderStarts = viewBoxSize
    ? [
        { x: 2, y: 2 },
        { x: viewBoxSize - 9, y: 2 },
        { x: 2, y: viewBoxSize - 9 }
      ]
    : [];
  const logoUnitSize = viewBoxSize * 0.2;
  const logoOffset = (viewBoxSize - logoUnitSize) / 2;
  const logoPadding = viewBoxSize * 0.035;
  const logoRadius = viewBoxSize * 0.045;

  return (
    <div className={cn("relative inline-flex", className)} style={{ height: size, width: size }}>
      <QRCodeSVG
        aria-hidden="true"
        className="pointer-events-none absolute opacity-0"
        imageSettings={imageSettings}
        level={logoSrc ? "H" : "M"}
        marginSize={2}
        ref={hiddenQrRef}
        size={size}
        value={value}
      />

      <svg
        aria-label="二维码"
        className="h-full w-full"
        height={size}
        role="img"
        viewBox={`0 0 ${viewBoxSize || size} ${viewBoxSize || size}`}
        width={size}
      >
        {logoSrc && viewBoxSize > 0 && (
          <defs>
            <clipPath id={logoClipId}>
              <rect height={logoUnitSize} rx={logoRadius} width={logoUnitSize} x={logoOffset} y={logoOffset} />
            </clipPath>
          </defs>
        )}
        <rect fill="#ffffff" height={viewBoxSize || size} rx="2" width={viewBoxSize || size} x="0" y="0" />
        <path d={foregroundPath} fill="#111827" />
        {finderStarts.map((start) => renderFinderPattern(start.x, start.y))}
        {logoSrc && viewBoxSize > 0 && (
          <>
            <rect
              fill="#ffffff"
              height={logoUnitSize + logoPadding * 2}
              rx={logoRadius + logoPadding}
              width={logoUnitSize + logoPadding * 2}
              x={logoOffset - logoPadding}
              y={logoOffset - logoPadding}
            />
            <image
              clipPath={`url(#${logoClipId})`}
              height={logoUnitSize}
              href={logoSrc}
              preserveAspectRatio="xMidYMid slice"
              width={logoUnitSize}
              x={logoOffset}
              y={logoOffset}
            />
          </>
        )}
      </svg>
    </div>
  );
}
