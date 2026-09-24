#!/usr/bin/env python3
"""Build offers.json: every open Solanart offer, grouped by maker (address at offset 97),
plus offers whose refund address (offset 1) is a different wallet, grouped by that address.
The page only uses it to know which accounts to look at; it re-reads each one on-chain
and checks program, size and maker before building anything."""
import base64, datetime, json, subprocess

RPC = "https://api.mainnet-beta.solana.com"
SOLANART = "CJsLwbP1iu5DuUikHEJnLfANgKy6stB2uFgvBBHoyxwz"
B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"

def b58(b):
    n = int.from_bytes(b, "big"); s = ""
    while n: n, r = divmod(n, 58); s = B58[r] + s
    return "1" * (len(b) - len(b.lstrip(b"\0"))) + s

body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "getProgramAccounts", "params": [SOLANART,
    {"encoding": "base64", "dataSlice": {"offset": 0, "length": 129}, "filters": [{"dataSize": 233}]}]}).encode()
raw = subprocess.run(["curl", "-s", "-m", "180", RPC, "-H", "content-type: application/json", "--data-binary", "@-"],
                     input=body, capture_output=True, check=True).stdout
res = json.loads(raw)["result"]
makers, refunds = {}, {}
for a in sorted(res, key=lambda a: -a["account"]["lamports"]):
    d = base64.b64decode(a["account"]["data"][0])
    maker, refund = b58(d[97:129]), b58(d[1:33])
    makers.setdefault(maker, []).append(a["pubkey"])
    if refund != maker:
        refunds.setdefault(refund, []).append(a["pubkey"])
out = {"generated": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%MZ"),
       "offers": len(res), "makers": dict(sorted(makers.items())), "refunds": dict(sorted(refunds.items()))}
json.dump(out, open("offers.json", "w"), separators=(",", ":"))
print(out["generated"], len(res), "offers,", len(makers), "makers,",
      round(sum(a["account"]["lamports"] for a in res) / 1e9, 3), "SOL")
