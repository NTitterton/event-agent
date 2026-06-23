export interface StockUniverseEntry {
  ticker: string;
  name: string;
}

export const sp500Universe: StockUniverseEntry[] = [
  { ticker: "AAPL", name: "Apple" },
  { ticker: "MSFT", name: "Microsoft" },
  { ticker: "AMZN", name: "Amazon" },
  { ticker: "NVDA", name: "Nvidia" },
  { ticker: "GOOGL", name: "Alphabet" },
  { ticker: "META", name: "Meta Platforms" },
  { ticker: "BRK.B", name: "Berkshire Hathaway" },
  { ticker: "LLY", name: "Eli Lilly" },
  { ticker: "AVGO", name: "Broadcom" },
  { ticker: "JPM", name: "JPMorgan Chase" },
  { ticker: "TSLA", name: "Tesla" },
  { ticker: "XOM", name: "Exxon Mobil" },
  { ticker: "UNH", name: "UnitedHealth Group" },
  { ticker: "V", name: "Visa" },
  { ticker: "MA", name: "Mastercard" },
  { ticker: "PG", name: "Procter & Gamble" },
  { ticker: "COST", name: "Costco Wholesale" },
  { ticker: "HD", name: "Home Depot" },
  { ticker: "JNJ", name: "Johnson & Johnson" },
  { ticker: "ABBV", name: "AbbVie" },
  { ticker: "MRK", name: "Merck" },
  { ticker: "BAC", name: "Bank of America" },
  { ticker: "KO", name: "Coca-Cola" },
  { ticker: "PEP", name: "PepsiCo" },
  { ticker: "CRM", name: "Salesforce" },
  { ticker: "NFLX", name: "Netflix" },
  { ticker: "WMT", name: "Walmart" },
  { ticker: "AMD", name: "Advanced Micro Devices" },
  { ticker: "ADBE", name: "Adobe" },
  { ticker: "CSCO", name: "Cisco Systems" },
  { ticker: "ORCL", name: "Oracle" },
  { ticker: "MCD", name: "McDonald's" },
  { ticker: "DIS", name: "Walt Disney" },
  { ticker: "INTC", name: "Intel" },
  { ticker: "TMO", name: "Thermo Fisher Scientific" },
  { ticker: "ACN", name: "Accenture" },
  { ticker: "ABT", name: "Abbott Laboratories" },
  { ticker: "LIN", name: "Linde" },
  { ticker: "DHR", name: "Danaher" },
  { ticker: "VZ", name: "Verizon" },
  { ticker: "CMCSA", name: "Comcast" },
  { ticker: "TXN", name: "Texas Instruments" },
  { ticker: "NEE", name: "NextEra Energy" },
  { ticker: "PM", name: "Philip Morris International" },
  { ticker: "IBM", name: "IBM" },
  { ticker: "GE", name: "GE Aerospace" },
  { ticker: "QCOM", name: "Qualcomm" },
  { ticker: "NOW", name: "ServiceNow" },
  { ticker: "CAT", name: "Caterpillar" },
  { ticker: "HON", name: "Honeywell" }
];

export function pickRandomStock(random: () => number = Math.random): StockUniverseEntry {
  const fallback = sp500Universe[0];
  if (!fallback) throw new Error("S&P 500 universe is empty");
  const index = Math.floor(random() * sp500Universe.length);
  return sp500Universe[Math.min(index, sp500Universe.length - 1)] ?? fallback;
}
