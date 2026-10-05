// Payouts: every DKNG reward payment StonkFun sent, read transaction by transaction.
// A payout = a transaction in which a StonkFun wallet's DKNG goes down, other wallets' DKNG goes up and
// no other token moves (that rules out the fee swaps), and no StonkFun wallet receives DKNG (that rules out
// funding the payout pot, which also pays the token creator's share).
// It covers ALL DKNG reward tokens: the transactions don't say which token a payout is for.
// Payouts go out in bursts ("rounds"); a new round starts after 5+ quiet minutes.
// Used twice: the last 2 days for the current pace, and since Sep 11 for every wallet ever paid.

import { balanceChanges, tokenAccountsFor } from "../solana.ts";
import { ADDR, SINCE, toDkng, utcDay, median, sum, forEachTransactionOf, historyRoute, type Progress } from "./shared.ts";

export async function getPayoutFlow({ since = SINCE, wallets = [ADDR.FEE_SELLER, ADDR.PAYOUT_WALLET], onProgress }: { since?: string; wallets?: string[]; onProgress?: Progress } = {}) {
  const fromSec = Date.parse(since) / 1000;
  const windowDays = (Date.now() / 1000 - fromSec) / 86400;
  const stonkfun = new Set<string>([ADDR.FEE_SELLER, ADDR.PAYOUT_WALLET]);

  const accounts: string[] = [];
  for (const wallet of wallets) {
    const [account] = await tokenAccountsFor(wallet, ADDR.DKNG);
    if (!account) throw new Error(`StonkFun wallet ${wallet} has no DKNG account: refusing to report zero payouts`);
    accounts.push(account);
  }

  const payouts: { t: number; payments: number; dkng: number }[] = [];
  const recipients = new Set<string>();
  const { read, unreadable } = await forEachTransactionOf("payouts", accounts, fromSec, (tx) => {
    const balances = [...tx.meta.preTokenBalances, ...tx.meta.postTokenBalances];
    if (balances.some((b) => b.mint !== ADDR.DKNG)) return; // another token moved: a swap, not a payout
    const change = balanceChanges(tx, ADDR.DKNG);
    // funding the payout pot moves DKNG from one StonkFun wallet to the other, with the token creator's
    // share paid in the same transaction: not a payment to holders
    if ([...stonkfun].some((w) => (change.get(w) ?? 0n) > 0n)) return;
    const fromStonkfun = [...stonkfun].some((w) => (change.get(w) ?? 0n) < 0n);
    const paid = [...change].filter(([owner, delta]) => delta > 0n && !stonkfun.has(owner));
    if (!fromStonkfun || !paid.length) return;
    for (const [owner] of paid) recipients.add(owner);
    payouts.push({ t: tx.blockTime, payments: paid.length, dkng: toDkng(paid.reduce((a, [, d]) => a + d, 0n)) });
  }, onProgress);

  payouts.sort((a, b) => a.t - b.t);
  const bursts: { end: number; txs: number; payments: number }[] = [];
  for (const p of payouts) {
    const last = bursts.at(-1);
    if (last && p.t - last.end < 300) { last.end = p.t; last.txs++; last.payments += p.payments; }
    else bursts.push({ end: p.t, txs: 1, payments: p.payments });
  }
  const rounds = bursts.filter((b) => b.txs >= 5); // a lone transfer is not a payout round

  const daily = new Map<string, { dkng: number; payments: number }>();
  for (const p of payouts) {
    const d = daily.get(utcDay(p.t)) ?? { dkng: 0, payments: 0 };
    d.dkng += p.dkng;
    d.payments += p.payments;
    daily.set(utcDay(p.t), d);
  }
  const payments = sum(payouts.map((p) => p.payments));
  const dkngPaid = sum(payouts.map((p) => p.dkng));
  return {
    sources: [`Solana RPC: ${await historyRoute()}, for StonkFun's DKNG accounts`],
    since,
    windowDays: Number(windowDays.toFixed(2)),
    transactionsRead: read,
    unreadable,
    payoutTransactions: payouts.length,
    payments,
    dkngPaid,
    uniqueRecipients: recipients.size,
    paymentsPerDay: payments / windowDays,
    dkngPerDay: dkngPaid / windowDays,
    roundsPerDay: rounds.length / windowDays,
    paymentsPerRound: median(rounds.map((r) => r.payments)),
    daily: [...daily].sort(([a], [b]) => a.localeCompare(b)).map(([d, v]) => ({ d, dkng: Number(v.dkng.toFixed(6)), payments: v.payments })),
  };
}
export type PayoutFlow = Awaited<ReturnType<typeof getPayoutFlow>>;
