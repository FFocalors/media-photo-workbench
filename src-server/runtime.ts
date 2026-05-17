let runtimeServerPort: number | null = null;

export function setRuntimeServerPort(port: number): void {
  runtimeServerPort = port;
}

export function getRuntimeServerPort(): number | null {
  return runtimeServerPort;
}
