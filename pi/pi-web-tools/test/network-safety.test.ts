import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import dns from "node:dns/promises";
import { assertUrlShape, isPrivateAddress, parseAllowlist, resolveAndValidate, resolveRedirect } from "../src/network-safety.js";

describe("network safety", () => {
  beforeEach(() => { delete process.env.PI_WEB_ALLOW_PRIVATE_NETWORK; vi.restoreAllMocks(); });
  afterEach(() => vi.restoreAllMocks());
  it("detects private IPv4/IPv6 and mapped loopback", () => { for (const ip of ["127.0.0.1","10.0.0.1","172.16.0.1","192.168.1.1","169.254.169.254","::1","fc00::1","fd00::1","fe80::1","::ffff:127.0.0.1"]) expect(isPrivateAddress(ip)).toBe(true); });
  it("rejects malformed schemes, credentials and disallowed ports", () => { expect(()=>assertUrlShape("ftp://x")).toThrow(); expect(()=>assertUrlShape("https://u:p@example.com")).toThrow(); expect(()=>assertUrlShape("https://example.com:22")).toThrow(); });
  it("parses exact allowlist and fails wildcards", () => { expect(parseAllowlist("http://localhost:8080,127.0.0.1/32").entries.length).toBe(2); expect(parseAllowlist("*").error).toBeTruthy(); });
  it("blocks multi-record with one private", async () => { vi.spyOn(dns, "lookup").mockResolvedValue([{ address: "93.184.216.34", family: 4 }, { address: "127.0.0.1", family: 4 }] as any); vi.spyOn(dns, "resolveCname").mockRejectedValue(new Error("none")); await expect(resolveAndValidate("https://example.com")).rejects.toThrow(/Private/); });
  it("allows exact localhost port when allowlisted", async () => { process.env.PI_WEB_ALLOW_PRIVATE_NETWORK="localhost:8080"; vi.spyOn(dns, "lookup").mockResolvedValue([{ address: "127.0.0.1", family: 4 }] as any); vi.spyOn(dns, "resolveCname").mockRejectedValue(new Error("none")); await expect(resolveAndValidate("http://localhost:8080")).resolves.toMatchObject({ selectedAddress: "127.0.0.1" }); });
  it("rejects cname to private", async () => { vi.spyOn(dns, "lookup").mockResolvedValue([{ address: "93.184.216.34", family: 4 }] as any); vi.spyOn(dns, "resolveCname").mockResolvedValue(["internal.local"] as any); await expect(resolveAndValidate("https://example.com")).rejects.toThrow(/CNAME/); });
  it("rejects downgrade redirects and handles protocol-relative", () => { expect(()=>resolveRedirect(new URL("https://a.test"), "http://b.test")).toThrow(); expect(resolveRedirect(new URL("https://a.test/x"), "//b.test/y").hostname).toBe("b.test"); });
});
