# Solanart offer withdraw

Unofficial, open-source page that returns SOL locked in old Solanart offers to the wallet that made them.
Not affiliated with Solanart.

## How Solanart offers hold your SOL

Every offer is its own 233-byte account owned by the Solanart program
`CJsLwbP1iu5DuUikHEJnLfANgKy6stB2uFgvBBHoyxwz`. The offer price sits in that account's balance.

| offset | field |
|---|---|
| 1 | refund address (gets the 0.0025 SOL account rent back) |
| 33 | NFT mint |
| 97 | maker (the wallet that made the offer) |

## What you sign

Only Solanart `Cancel Bid` instructions (data `03`), one per offer, up to 8 per transaction.
Accounts: maker (signer, receives the SOL), offer (closed), refund address from the offer, NFT mint, System Program.
No token approvals, no transfers to anyone else. Network fee is 0.000005 SOL per transaction.

Before your wallet sees a transaction, the page checks that it contains nothing else: every instruction
is a Solanart Cancel Bid for an offer whose maker is your wallet, with the refund and mint exactly as
stored in that offer, and you are the fee payer. Anything else is refused.

## Where the offer list comes from

Public Solana RPCs refuse to search a program's accounts from a browser. `offers.json` is a list of
open offers grouped by maker, built by `build_index.py`. The page uses it only to know which accounts
to look at. It then re-reads every account on-chain and keeps it only if it is still owned by Solanart,
is 233 bytes long, and has your wallet as maker. Offers made after the list date are not shown.

To refresh the list:

```
python3 build_index.py
```

## Check it yourself

- Open "Check any address without connecting", paste a wallet: the page lists its offers and simulates
  the withdrawal without signing anything.
- Your wallet (Phantom, Solflare, Backpack) shows its own simulation before you approve.
- `web3.iife.min.js` is `@solana/web3.js` 1.98.0 from npm, unchanged.
