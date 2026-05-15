import { Router } from "express";
import os from "os";
import { getConfig } from "../config/config";
import { sendSuccess } from "../utils/response";
import { checkRepository } from "../services/repository";

const router = Router();

function getLanAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses: Array<{ name: string; address: string; family: string; internal: boolean }> = [];

  for (const [name, entries] of Object.entries(interfaces)) {
    if (!isPhysicalLanInterface(name)) continue;
    for (const entry of entries ?? []) {
      if (entry.family !== "IPv4" || entry.internal) continue;
      addresses.push({
        name,
        address: entry.address,
        family: entry.family,
        internal: entry.internal
      });
    }
  }

  return addresses;
}

function isPhysicalLanInterface(name: string): boolean {
  const lowerName = name.toLowerCase();
  const virtualKeywords = [
    "vmware",
    "virtual",
    "vethernet",
    "hyper-v",
    "wsl",
    "docker",
    "virtualbox",
    "vbox",
    "tailscale",
    "zerotier",
    "tap",
    "tunnel",
    "bluetooth",
    "loopback",
    "npcap",
    "pseudo",
    "vmnet"
  ];
  if (virtualKeywords.some((keyword) => lowerName.includes(keyword))) {
    return false;
  }

  return [
    "wi-fi",
    "wifi",
    "wlan",
    "wireless",
    "以太网",
    "ethernet"
  ].some((keyword) => lowerName.includes(keyword));
}

/**
 * GET /api/health
 * 健康检查接口，返回 server、database、repository、config 状态。
 */
router.get("/", (_req, res) => {
  const config = getConfig();
  const repoCheck = config.repository.path
    ? checkRepository(config.repository.path)
    : { exists: false, readable: false, writable: false, freeSpace: null, path: "" };

  sendSuccess(res, {
    service: "media-photo-workbench",
    server: {
      port: config.server.port,
      status: "running"
    },
    database: {
      status: "connected"
    },
    repository: {
      configured: !!config.repository.path,
      ...repoCheck
    },
    config: {
      loaded: true,
      server: config.server,
      repository: config.repository
    },
    network: {
      localhost: "127.0.0.1",
      lanAddresses: getLanAddresses(),
      hotspotAddress: "192.168.137.1"
    }
  });
});

export default router;
