// Runs only as the fixed doctor canary; never supplied by the worker model.
export function probeProgram(p: any) {
  const fs = process.getBuiltinModule("fs"),
    net = process.getBuiltinModule("net");
  const out: Record<string, boolean> = {};
  const attempt = (fn: () => void) => {
    try {
      fn();
      return true;
    } catch {
      return false;
    }
  };
  out.control_read = !attempt(() => fs.readFileSync(p.control));
  out.control_write = !attempt(() => fs.writeFileSync(p.control, "BAD"));
  out.source_read = !attempt(() => fs.readdirSync(p.source));
  out.outside_read = attempt(() => fs.readFileSync(p.outside)) === p.allowRead;
  out.outside_write = !attempt(() => fs.writeFileSync(p.outside, "BAD"));
  out.protected_write = !attempt(() =>
    fs.writeFileSync("protected.txt", "BAD"),
  );
  out.protected_delete = !attempt(() => fs.unlinkSync("protected-delete.txt"));
  out.allowed_write = attempt(() => fs.writeFileSync("allowed.txt", "OK"));
  if (p.privateFile)
    out.private_read = !attempt(() => fs.readFileSync(p.privateFile));
  if (p.codexHome)
    out.codex_home_read = !attempt(() => fs.readdirSync(p.codexHome));
  out.secret_env = !Object.keys(process.env).some((k) =>
    p.secretNames.some((n: string) => n.toLowerCase() === k.toLowerCase()),
  );
  const s = net.connect({ host: "127.0.0.1", port: p.port });
  let done = false;
  function finish(connected: boolean) {
    if (done) return;
    done = true;
    out.network_policy = connected === p.allowNetwork;
    s.destroy();
    console.log("HARNESS_PROBE=" + JSON.stringify(out));
    process.exit(Object.values(out).every(Boolean) ? 0 : 1);
  }
  s.on("connect", () => finish(true));
  s.on("error", () => finish(false));
  setTimeout(() => finish(false), 2000);
}
