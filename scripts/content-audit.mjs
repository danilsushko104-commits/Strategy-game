import { pathToFileURL } from 'node:url';
import { MARKETS, SOURCES } from '../src/scenario.mjs';

// Looks for player-visible text, links and sources of one market that name another market's country,
// currency, institutions or services. Such a mention can be right (a real cross-border link) or a slip;
// the report lists each one with its context so that a person can decide.
//
//   node scripts/content-audit.mjs

const MARKERS = {
  indonesia: ["Indonesia", "Indonesian", "Jakarta", "IDR", "Rupiah", "QRIS", "Bank Indonesia", "Bahasa", "Mandiri", "BCA", "bi.go.id"],
  philippines: ["Philippines", "Philippine", "Filipino", "Manila", "PHP", "BSP", "Bangko Sentral", "QR Ph", "InstaPay", "GCash", "Maya", "bsp.gov.ph", "gcash"],
  thailand: ["Thailand", "Thai", "Bangkok", "THB", "Baht", "Bank of Thailand", "PromptPay", "SCB", "KBank", "Kasikorn", "bot.or.th", "YouTrip"],
  vietnam: ["Vietnam", "Vietnamese", "Ho Chi Minh", "VND", "Dong", "NAPAS", "VietQR", "Techcombank", "Vietcombank", "napas.com.vn"]
};

// Every string a team can read about a market, with the place it comes from.
function* texts(marketId, market) {
  yield* market.facts.map(([label, value], index) => [`facts[${index}] ${label}`, value]);
  for (const id of market.sources) yield [`source ${id}`, SOURCES[id].join(" ")];
  for (const [route, [name, detail]] of Object.entries(market.candidates)) yield [`candidate ${route}`, name + " " + detail];
  yield ["diligence", market.diligence];
  for (const [key, profile] of Object.entries(market.profiles)) {
    for (const [field, value] of Object.entries(profile)) {
      if (field === "alternatives") for (const [name, detail, link] of value) yield [`profile ${key} alternative`, [name, detail, link].join(" ")];
      else if (typeof value === "string") yield [`profile ${key} ${field}`, value];
    }
  }
}

export function audit() {
  const findings = [];
  for (const [marketId, market] of Object.entries(MARKETS)) {
    for (const [where, text] of texts(marketId, market)) {
      for (const [other, words] of Object.entries(MARKERS)) {
        if (other === marketId) continue;
        for (const word of words) {
          const at = text.search(new RegExp("\\b" + word.replace(".", "\\.") + "\\b|" + word.replace(".", "\\."), "i"));
          if (at >= 0 && new RegExp("(^|[^A-Za-z])" + word.replace(".", "\\.") + "([^A-Za-z]|$)", "i").test(text)) {
            findings.push({market: marketId, where, mentions: other, word, context: text.slice(Math.max(0, at - 50), at + 70).replace(/\s+/g, " ")});
            break;
          }
        }
      }
    }
  }
  return findings;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const findings = audit();
  console.log(findings.length ? findings.length + " mention(s) of another market:\n" : "No market mentions another market.");
  for (const item of findings) console.log(`- ${item.market} · ${item.where} → ${item.mentions} (“${item.word}”): …${item.context}…`);
  console.log("\nSources per market:");
  for (const [id, market] of Object.entries(MARKETS)) console.log(`- ${id}: ` + market.sources.map(source => SOURCES[source][0]).join(" | "));
}
