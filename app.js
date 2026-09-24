"use strict";
// Solanart offer withdraw. Finds every open Solanart offer made by your wallet and cancels them.
// The transactions are built here, in the open: only Solanart "Cancel Bid" instructions,
// each returning the offer's SOL to your own wallet.

const W = solanaWeb3;
const SOLANART = new W.PublicKey("CJsLwbP1iu5DuUikHEJnLfANgKy6stB2uFgvBBHoyxwz"); // Solanart program
const OFFER_SIZE = 233;            // offer account: [1] refund @1, mint @33, maker @97
const RENT = 2512560;              // rent of a 233-byte account; goes back to the refund address @1
const PER_TX = 8;                  // cancels per transaction (fits the 1232-byte limit)
const RPCS  = ["https://solana-rpc.publicnode.com", "https://api.mainnet-beta.solana.com"]; // same list as the CSP

const $ = id => document.getElementById(id);
let conn, provider, owner, offers = [];

// Status text is always set as plain text; links are built only from signatures we got back.
function log(text, cls, links) {
  const el = $("log");
  el.textContent = "";
  const span = document.createElement("span");
  if (cls) span.className = cls;
  span.textContent = text;
  el.appendChild(span);
  for (const l of links || []) {
    const a = document.createElement("a");
    a.href = l.href; a.textContent = l.text; a.target = "_blank"; a.rel = "noopener noreferrer";
    el.appendChild(document.createTextNode("\n"));
    el.appendChild(a);
  }
}

function setSim(text, cls) {
  const s = document.createElement("span");
  s.className = cls; s.textContent = text;
  $("sim").replaceChildren(s);
}

const sol = l => (l / 1e9).toLocaleString("en-US", { maximumFractionDigits: 9 }) + " SOL";
const short = s => s.slice(0, 4) + "…" + s.slice(-4);

async function rpc() {
  if (conn) return conn;
  for (const u of RPCS) {
    try { const c = new W.Connection(u, "confirmed"); await c.getLatestBlockhash(); return (conn = c); }
    catch (e) { console.warn("RPC", u, e); }
  }
  throw new Error("could not connect to a Solana RPC");
}

// Public RPCs refuse to search the Solana program from a browser, so offers.json (built by
// build_index.py) says which accounts to look at. Each one is re-read on-chain here and kept
// only if it is still a live Solanart offer whose maker (@97) is this wallet. Offers where this
// wallet is only the rent-refund address (@1) are returned separately, as "other": another wallet made them.
let index;
async function findOffers(pk) {
  if (!index) {
    index = await (await fetch("offers.json", { cache: "no-store" })).json();
    $("indexNote").textContent = "Offer list updated " + index.generated.replace("T", " ")
      + ". Offers made after that are not shown yet.";
  }
  const a58 = pk.toBase58();
  const keys = [...new Set([...(index.makers[a58] || []), ...(index.refunds[a58] || [])])].map(k => new W.PublicKey(k));
  const c = await rpc(), out = [];
  for (let i = 0; i < keys.length; i += 10) {           // publicnode serves at most 10 per call
    const infos = await c.getMultipleAccountsInfo(keys.slice(i, i + 10), "confirmed");
    infos.forEach((a, j) => {
      if (!a || !a.owner.equals(SOLANART) || a.data.length !== OFFER_SIZE) return;  // closed or not an offer
      const d = a.data;
      out.push({ offer: keys[i + j], lamports: a.lamports,
        refund: new W.PublicKey(d.slice(1, 33)), mint: new W.PublicKey(d.slice(33, 65)),
        maker: new W.PublicKey(d.slice(97, 129)) });
    });
  }
  out.sort((a, b) => b.lamports - a.lamports);
  return { own: out.filter(o => o.maker.equals(pk)),
           other: out.filter(o => !o.maker.equals(pk) && o.refund.equals(pk)) };
}

function cancelIx(pk, o) {
  const refundIsMaker = o.refund.equals(pk);
  return new W.TransactionInstruction({ programId: SOLANART, data: Uint8Array.of(3), keys: [
    { pubkey: pk, isSigner: true, isWritable: true },                 // maker: signs, receives the SOL
    { pubkey: o.offer, isSigner: false, isWritable: true },           // offer: closed
    { pubkey: o.refund, isSigner: refundIsMaker, isWritable: true },  // refund address from the offer: gets the rent
    { pubkey: o.mint, isSigner: false, isWritable: false },
    { pubkey: W.SystemProgram.programId, isSigner: false, isWritable: false },
  ]});
}

function chunks(list) {
  const out = [];
  for (let i = 0; i < list.length; i += PER_TX) out.push(list.slice(i, i + PER_TX));
  return out;
}

async function simulate(pk, group) {
  const c = await rpc();
  const { blockhash } = await c.getLatestBlockhash("confirmed");
  const msg = new W.TransactionMessage({ payerKey: pk, recentBlockhash: blockhash,
    instructions: group.map(o => cancelIx(pk, o)) }).compileToLegacyMessage();
  const sim = await c.simulateTransaction(new W.VersionedTransaction(msg),
    { sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed" });
  if (sim.value.err) console.log(sim.value.logs);
  return sim.value.err;
}

function offerRow(o, note) {
  const row = document.createElement("div"); row.className = "row";
  const a = document.createElement("a");
  a.href = "https://solscan.io/account/" + o.offer.toBase58();
  a.target = "_blank"; a.rel = "noopener noreferrer"; a.className = "mono";
  a.textContent = "offer " + short(o.offer.toBase58()) + " · NFT " + short(o.mint.toBase58()) + (note || "");
  const v = document.createElement("span"); v.textContent = sol(o.lamports - RENT);
  row.append(a, v);
  return row;
}

function showOffers(own, other) {
  const box = $("offers");
  box.replaceChildren(...own.map(o => offerRow(o)));
  if (!other.length) return;
  const h = document.createElement("div"); h.className = "lbl";
  h.textContent = "Made by another wallet — only that wallet can withdraw them:";
  box.append(h, ...other.map(o => offerRow(o, " · maker " + short(o.maker.toBase58()))));
}

async function inspect(pk) {
  const { own: list, other } = await findOffers(pk);
  const total = list.reduce((s, o) => s + o.lamports - RENT, 0);
  $("count").textContent = String(list.length);
  $("amount").textContent = list.length ? sol(total) : "—";
  showOffers(list, other);
  if (!list.length) { setSim("no open offers", "bad"); return { list, other, ok: false }; }
  for (const g of chunks(list)) {
    const err = await simulate(pk, g);
    if (err) { setSim("error: " + JSON.stringify(err), "bad"); return { list, other, ok: false, err }; }
  }
  setSim("passes ✓", "ok");
  return { list, other, ok: true };
}

// Last check before the wallet sees a transaction: only Solanart Cancel Bid instructions,
// each for an offer this wallet made, with the refund and mint exactly as stored in that offer.
function assertSafe(tx, pk) {
  const byKey = new Map(offers.map(o => [o.offer.toBase58(), o]));
  const ok = tx.feePayer.equals(pk) && tx.instructions.length > 0 && tx.instructions.every(ix => {
    const k = ix.keys, o = k.length === 5 && byKey.get(k[1].pubkey.toBase58());
    return o && ix.programId.equals(SOLANART) && ix.data.length === 1 && ix.data[0] === 3
      && o.maker.equals(pk) && k[0].pubkey.equals(pk) && k[2].pubkey.equals(o.refund)
      && k[3].pubkey.equals(o.mint) && !k[3].isSigner && k[4].pubkey.equals(W.SystemProgram.programId);
  });
  if (!ok) throw new Error("safety check failed, transaction not sent");
}

// This wallet made no offers but is the rent-refund address of offers another wallet made.
function otherMsg(other) {
  const makers = [...new Set(other.map(o => o.maker.toBase58()))];
  return "This wallet did not make these offers; it only gets their small rent refund. "
    + "The SOL (" + sol(other.reduce((t, o) => t + o.lamports - RENT, 0)) + ") goes to the wallet that made them. "
    + "Open this page with " + (makers.length > 1 ? "one of these wallets" : "that wallet") + " to withdraw:\n" + makers.join("\n");
}

function pickProvider() {
  return window.phantom?.solana || window.solflare || window.backpack || window.solana || null;
}

$("connect").onclick = async () => {
  try {
    provider = pickProvider();
    if (!provider) { log("No wallet found. Open this page in a browser with Phantom/Solflare, or in your wallet app's built-in browser.", "bad"); return; }
    const r = await provider.connect();
    owner = new W.PublicKey((r && r.publicKey) || provider.publicKey);
    $("wallet").textContent = owner.toBase58();
    log("Looking for your Solanart offers…");
    const s = await inspect(owner);
    offers = s.list;
    const n = chunks(offers).length;
    const bal = await (await rpc()).getBalance(owner);
    if (!offers.length) log(s.other.length ? otherMsg(s.other) : "This wallet has no open Solanart offers.", "bad");
    else if (!s.ok) log("Simulation failed — do not sign. Details are in the browser console.", "bad");
    else if (bal < 10000 * n) log("Not enough SOL in the wallet for the network fee (need ~" + sol(5000 * n) + ").", "bad");
    else {
      log("Ready: press “Withdraw”. " + (n > 1 ? "Your wallet will ask you to approve " + n + " transactions." : "Your wallet will show that you receive the amount above."));
      $("withdraw").disabled = false;
    }
  } catch (e) { log("Error: " + (e.message || e), "bad"); }
};

$("withdraw").onclick = async () => {
  $("withdraw").disabled = true;
  try {
    const c = await rpc();
    const s = await inspect(owner);               // fresh list and simulation right before signing
    offers = s.list;
    if (!s.ok) throw new Error(offers.length ? "simulation failed: " + JSON.stringify(s.err) : "no open offers");
    const { blockhash, lastValidBlockHeight } = await c.getLatestBlockhash("confirmed");
    const txs = chunks(offers).map(g => {
      const tx = new W.Transaction({ feePayer: owner, blockhash, lastValidBlockHeight });
      tx.add(...g.map(o => cancelIx(owner, o)));
      assertSafe(tx, owner);
      return tx;
    });
    log("Approve " + (txs.length > 1 ? "the " + txs.length + " transactions" : "the transaction") + " in your wallet…");
    const sigs = [];
    if (txs.length > 1 && provider.signAllTransactions) {
      const signed = await provider.signAllTransactions(txs);
      for (const t of signed) sigs.push(await c.sendRawTransaction(t.serialize()));
    } else {
      for (const tx of txs) {
        if (provider.signAndSendTransaction) { const r = await provider.signAndSendTransaction(tx); sigs.push(r.signature || r); }
        else sigs.push(await c.sendRawTransaction((await provider.signTransaction(tx)).serialize()));
      }
    }
    log("Sent, waiting for confirmation…");
    for (const sig of sigs) {
      const res = await c.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
      if (res.value.err) throw new Error("transaction failed: " + JSON.stringify(res.value.err) + "\n" + sig);
    }
    const total = offers.reduce((t, o) => t + o.lamports - RENT, 0);
    log("Done ✓ " + sol(total) + " is now in your wallet.", "ok",
        sigs.map((g, i) => ({ href: "https://solscan.io/tx/" + encodeURIComponent(g), text: "View on Solscan" + (sigs.length > 1 ? " (" + (i + 1) + ")" : "") })));
    offers = (await inspect(owner)).list;
  } catch (e) {
    log("Error: " + (e.message || e), "bad");
    $("withdraw").disabled = false;
  }
};

$("probeBtn").onclick = async () => {
  try {
    const pk = new W.PublicKey($("probe").value.trim());
    $("wallet").textContent = pk.toBase58() + " (read-only)";
    log("Checking…");
    const s = await inspect(pk);
    log(s.ok ? "Withdrawing these offers passes simulation. Only the wallet's owner can sign it."
             : s.list.length ? "Simulation failed." : s.other.length ? otherMsg(s.other) : "No open Solanart offers for this wallet.", s.ok ? "ok" : "bad");
  } catch (e) { log("Error: " + (e.message || e), "bad"); }
};
