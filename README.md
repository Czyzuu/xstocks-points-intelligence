# xStocks Points Intelligence

An independent analytics dashboard for public xPoints data. It presents community-tracked totals, activity-source composition, wallet percentile cutoffs, chain coverage, and a paginated leaderboard.

Data is read-only and proxied from the public JSON endpoints at xpoints.io. The app never connects to a wallet, requests a signature, or handles private keys. xpoints.io is a community-built source and this project is not affiliated with xStocks, Backed, or Kraken.

## Run

```bash
npm start
```

Open <http://localhost:4173>. Node.js 18 or newer is required; there are no package dependencies.

## Deploy to Vercel

Import this directory as a Vercel project with the framework preset set to **Other**. No build command or output-directory override is required.

## Pendle YT yield accounting

The dashboard combines direct `redeemYtYield` history with market-attributed distributions from `/v2/dashboard/merkle-rewards/{user}`. Distributed claimed token amounts are displayed at current prices, separately from Pendle's historical aggregate net-gain accounting. Claimed distributions are already included in that aggregate and are not added again to PnL. Claimable distributions are included in pending yield; open-window estimates are excluded.

Incomplete reward/history data, unpriced claimable tokens, and mixed PT/LP market histories show unavailable YT PnL rather than a fabricated zero. Limit-order YT trades are included. Tests include the November STRCx wallet regression and four Ethereum distributor payouts that reconcile exactly to `941541086108696148` raw STRCx units (0.941541086108696148 STRCx).

For supported Ethereum positions with buys only, underlying-token transfers from Blockscout provide a funding split when distributor receipts reconcile exactly with one market's claimed total. The split allocates that market's yield first to later YT purchases, subtracting intervening token outflows; it is an attribution estimate because wallet tokens are fungible. Other funding includes earlier-maturity proceeds. Purchase cost still includes reinvestment, and PnL still counts the yield only once. Explorer failures or ambiguous/partial histories leave the split unavailable without changing PnL. The social card keeps its return percentage based on gross capital and labels that basis explicitly.
