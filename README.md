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
