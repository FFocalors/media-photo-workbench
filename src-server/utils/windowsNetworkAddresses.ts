import os from "os";

export type WindowsNetworkAddressKind = "hotspot" | "wlan" | "ethernet" | "lan";

export interface WindowsNetworkAddress {
  id: string;
  label: string;
  address: string;
  interfaceName: string;
  kind: WindowsNetworkAddressKind;
  detected: boolean;
  recommended: boolean;
}

export interface WindowsNetworkAddresses {
  hotspot: WindowsNetworkAddress | null;
  wlan: WindowsNetworkAddress[];
  ethernet: WindowsNetworkAddress[];
  lan: WindowsNetworkAddress[];
  recommendedAddress: string;
  hotspotCandidate: string;
  warnings: string[];
}

const WINDOWS_HOTSPOT_ADDRESS = "192.168.137.1";
const HOTSPOT_INTERFACE_KEYWORDS = ["wi-fi direct", "wifi direct", "mobile hotspot", "移动热点"];
const WLAN_KEYWORDS = ["wi-fi", "wifi", "wlan", "wireless", "无线局域网", "无线网络"];
const ETHERNET_KEYWORDS = ["ethernet", "以太网"];
const IRRELEVANT_INTERFACE_KEYWORDS = [
  "docker",
  "wsl",
  "vmware",
  "virtualbox",
  "vbox",
  "hyper-v",
  "vethernet",
  "tailscale",
  "zerotier",
  "loopback",
  "npcap",
  "bluetooth",
  "tunnel",
  "tap",
  "pseudo",
  "vmnet"
];

function isIpv4(value: string): boolean {
  const parts = value.split(".");
  return parts.length === 4 && parts.every((part) => {
    const number = Number(part);
    return /^\d{1,3}$/.test(part) && Number.isInteger(number) && number >= 0 && number <= 255;
  });
}

function isLoopbackOrApipa(address: string): boolean {
  return address.startsWith("127.") || address.startsWith("169.254.") || address === "0.0.0.0";
}

function includesAny(value: string, keywords: string[]): boolean {
  return keywords.some((keyword) => value.includes(keyword));
}

/**
 * Classifies a single IPv4 address without ever discarding the well-known
 * Windows Mobile Hotspot address merely because its adapter is virtual.
 */
export function classifyWindowsNetworkAddress(
  interfaceName: string,
  address: string
): WindowsNetworkAddressKind | null {
  if (!isIpv4(address) || isLoopbackOrApipa(address)) return null;
  if (address === WINDOWS_HOTSPOT_ADDRESS) return "hotspot";

  const normalizedName = interfaceName.toLowerCase();
  if (includesAny(normalizedName, HOTSPOT_INTERFACE_KEYWORDS)) return "hotspot";
  if (includesAny(normalizedName, IRRELEVANT_INTERFACE_KEYWORDS)) return null;
  if (includesAny(normalizedName, WLAN_KEYWORDS)) return "wlan";
  if (includesAny(normalizedName, ETHERNET_KEYWORDS)) return "ethernet";

  // Keep other valid LAN addresses available for diagnostics, while the UI
  // continues to prioritise explicit WLAN and hotspot entries.
  return "lan";
}

export function getWindowsNetworkAddresses(
  interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = os.networkInterfaces()
): WindowsNetworkAddresses {
  const addresses: WindowsNetworkAddress[] = [];
  const seen = new Set<string>();

  for (const [interfaceName, entries] of Object.entries(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.family !== "IPv4" || entry.internal || seen.has(entry.address)) continue;
      const kind = classifyWindowsNetworkAddress(interfaceName, entry.address);
      if (!kind) continue;
      seen.add(entry.address);
      addresses.push({
        id: `${interfaceName}-${entry.address}`,
        label: kind === "hotspot"
          ? "Windows 热点地址"
          : kind === "wlan"
            ? "WLAN / Wi-Fi 地址"
            : kind === "ethernet"
              ? "有线 LAN 地址"
              : "局域网地址",
        address: entry.address,
        interfaceName,
        kind,
        detected: true,
        recommended: false
      });
    }
  }

  const hotspot = addresses.find((item) => item.kind === "hotspot") ?? null;
  const wlan = addresses.filter((item) => item.kind === "wlan");
  const ethernet = addresses.filter((item) => item.kind === "ethernet");
  const lan = addresses.filter((item) => item.kind === "lan");
  const recommended = hotspot ?? wlan[0] ?? ethernet[0] ?? lan[0] ?? null;
  if (recommended) recommended.recommended = true;

  const warnings: string[] = [];
  if (wlan.length > 0) {
    warnings.push("普通 Wi-Fi 可能启用了客户端隔离；相机无法连接时可改用 Windows 移动热点。");
  }
  if (!hotspot) {
    warnings.push("当前未检测到 Windows 移动热点；开启热点后通常使用 192.168.137.1。");
  }

  return {
    hotspot,
    wlan,
    ethernet,
    lan,
    recommendedAddress: recommended?.address ?? "",
    hotspotCandidate: WINDOWS_HOTSPOT_ADDRESS,
    warnings
  };
}
