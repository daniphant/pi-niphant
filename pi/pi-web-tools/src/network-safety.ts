import dns from "node:dns/promises";
import net from "node:net";
import { NetworkSafetyError } from "./errors.js";

const MAX_ALLOWLIST = 64;
export interface AllowEntry { host?: string; port?: number; ip?: string; cidr?: number }
export interface ValidationResult { url: URL; addresses: string[]; selectedAddress: string; allowlistActive: boolean }

function normalizeHost(host: string) { return host.replace(/^\[|\]$/g, "").toLowerCase(); }
function ipv4ToInt(ip: string) { return ip.split(".").reduce((n, p) => (n << 8) + Number(p), 0) >>> 0; }
function in4(ip: string, cidr: string, bits: number) { const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0; return (ipv4ToInt(ip) & mask) === (ipv4ToInt(cidr) & mask); }
export function unmapIPv4(ip: string) { return ip.toLowerCase().startsWith("::ffff:") ? ip.slice(7) : ip; }

export function isPrivateAddress(raw: string): boolean {
  const ip = unmapIPv4(raw);
  if (net.isIPv4(ip)) return ip === "0.0.0.0" || in4(ip,"10.0.0.0",8) || in4(ip,"127.0.0.0",8) || in4(ip,"169.254.0.0",16) || in4(ip,"172.16.0.0",12) || in4(ip,"192.168.0.0",16) || in4(ip,"100.64.0.0",10) || in4(ip,"192.0.0.0",24) || in4(ip,"198.18.0.0",15) || in4(ip,"224.0.0.0",4) || ip === "255.255.255.255";
  const low = ip.toLowerCase();
  return low === "::1" || low === "::" || low.startsWith("fc") || low.startsWith("fd") || low.startsWith("fe8") || low.startsWith("fe9") || low.startsWith("fea") || low.startsWith("feb") || low.startsWith("ff");
}

export function parseAllowlist(value = process.env.PI_WEB_ALLOW_PRIVATE_NETWORK ?? ""): { entries: AllowEntry[]; error?: string; active: boolean } {
  if (!value.trim()) return { entries: [], active: false };
  const parts = value.split(",").map(s => s.trim()).filter(Boolean);
  if (parts.length > MAX_ALLOWLIST) return { entries: [], active: true, error: `PI_WEB_ALLOW_PRIVATE_NETWORK has too many entries (max ${MAX_ALLOWLIST})` };
  const entries: AllowEntry[] = [];
  for (const part of parts) {
    if (/[*?]/.test(part)) return { entries: [], active: true, error: "wildcards are not allowed in PI_WEB_ALLOW_PRIVATE_NETWORK" };
    try {
      if (/^https?:\/\//i.test(part)) { const u = new URL(part); if (!u.port) return { entries: [], active: true, error: `allowlist origin requires explicit port: ${part}` }; entries.push({ host: normalizeHost(u.hostname), port: Number(u.port) }); continue; }
      const cidr = part.match(/^([0-9.]+)\/(\d{1,2})$/); if (cidr) { const bits=Number(cidr[2]); if (!net.isIPv4(cidr[1])||bits<0||bits>32) throw new Error(); entries.push({ ip: cidr[1], cidr: bits }); continue; }
      if (net.isIP(part)) { entries.push({ ip: unmapIPv4(part), cidr: net.isIPv4(unmapIPv4(part)) ? 32 : 128 }); continue; }
      const idx = part.lastIndexOf(":"); if (idx <= 0) throw new Error(); const host = normalizeHost(part.slice(0, idx)); const port = Number(part.slice(idx + 1)); if (!host || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error(); entries.push({ host, port });
    } catch { return { entries: [], active: true, error: `invalid PI_WEB_ALLOW_PRIVATE_NETWORK entry: ${part}` }; }
  }
  return { entries, active: true };
}

export function isAllowedByPrivateAllowlist(url: URL, address: string, entries = parseAllowlist().entries): boolean {
  const host = normalizeHost(url.hostname); const port = effectivePort(url);
  return entries.some(e => (e.host === host && e.port === port) || (e.ip && net.isIPv4(unmapIPv4(address)) && (e.cidr === 32 ? e.ip === unmapIPv4(address) : in4(unmapIPv4(address), e.ip, e.cidr ?? 32))));
}

export function effectivePort(url: URL): number { return url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80; }
export function assertUrlShape(input: string): URL {
  let url: URL; try { url = new URL(input); } catch { throw new NetworkSafetyError("URL is malformed"); }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new NetworkSafetyError("Only http:// and https:// URLs are supported");
  if (url.username || url.password) throw new NetworkSafetyError("Credentialed URLs are not allowed");
  const port = effectivePort(url); if (![80,443].includes(port)) { const al=parseAllowlist(); if (al.error || !al.entries.length || !al.entries.some(e=>e.host===normalizeHost(url.hostname)&&e.port===port)) throw new NetworkSafetyError(`Port ${port} is not allowed`); }
  return url;
}

export async function resolveAndValidate(input: string | URL): Promise<ValidationResult> {
  const url = typeof input === "string" ? assertUrlShape(input) : assertUrlShape(input.toString());
  const allow = parseAllowlist();
  if (allow.error) throw new NetworkSafetyError(allow.error);
  const hostname = normalizeHost(url.hostname);
  let addresses: string[] = [];
  if (net.isIP(hostname)) addresses = [unmapIPv4(hostname)]; else {
    const lookup = dns.lookup(hostname, { all: true, verbatim: false });
    const timeout = new Promise<never>((_, rej) => setTimeout(() => rej(new NetworkSafetyError("DNS lookup timed out")), 2000));
    addresses = (await Promise.race([lookup, timeout])).map(a => unmapIPv4(a.address));
    try { await checkCname(hostname); } catch (e) { if (e instanceof NetworkSafetyError) throw e; }
  }
  if (!addresses.length) throw new NetworkSafetyError("DNS lookup returned no addresses");
  for (const address of addresses) if (isPrivateAddress(address) && !isAllowedByPrivateAllowlist(url, address, allow.entries)) throw new NetworkSafetyError(`Private or local address is blocked: ${address}`);
  return { url, addresses, selectedAddress: addresses[0], allowlistActive: allow.active };
}

async function checkCname(host: string, seen = new Set<string>()): Promise<void> {
  if (seen.size >= 5) throw new NetworkSafetyError("CNAME chain too deep or looped");
  if (seen.has(host)) throw new NetworkSafetyError("CNAME loop detected");
  seen.add(host);
  let names: string[] = []; try { names = await dns.resolveCname(host); } catch { return; }
  for (const name of names) { const recs = await dns.lookup(name, { all: true }).catch(()=>[]); for (const r of recs) if (isPrivateAddress(r.address)) throw new NetworkSafetyError("CNAME resolves to a private address"); await checkCname(name, seen); }
}

export function resolveRedirect(base: URL, location: string): URL {
  const next = new URL(location, base);
  if (base.protocol === "https:" && next.protocol === "http:") throw new NetworkSafetyError("HTTPS to HTTP redirects are blocked");
  return assertUrlShape(next.toString());
}
