import { fileURLToPath, pathToFileURL } from 'node:url';
import { CONFIG, MARKETS, ROUNDS } from '../src/scenario.mjs';
import { optionsFor, replay, gameScore, price, PRICE, problemFor } from '../src/rules.mjs';
import { LEGACY, V3, useTuning } from '../src/tuning.mjs';

// Balance report for a tuning set. The game is a decision tree with one point of chance (the full retest),
// so every choice is valued as a team would value it: the best option at each decision, the average over
// chance. An option is "viable" at a node when its value is within `gap` points of the best option there.
//
//   node scripts/balance.mjs            evaluate the approved settings (V3)
//   node scripts/balance.mjs legacy     evaluate the game as played so far

const PRACTICE = {game: CONFIG.game, version: CONFIG.version, mode: "practice", team: 1, room: "PRACTICE", session: "balance", drafts: {}, notes: {}, brief: "", bulletinB: false};
const ROUTES = ["pilot", "alliance", "acquisition"];

export function analyze(config, {gap = 5} = {}) {
  let forced = [0, 0];
  const evaluated = {...config, randomness: {...config.randomness, draw: key => forced[key.endsWith("|2") ? 1 : 0]}};
  const restore = useTuning(evaluated);
  try {
    const spread = config.randomness.retestSpread;
    const chances = [[-1, spread], [0, 1 - 2 * spread], [1, spread]].filter(([, probability]) => probability > 0);
    const result = {config: config.name, gap, markets: {}, leaves: []};

    for (const [marketId, market] of Object.entries(MARKETS)) {
      const options = {};      // "R3.alliance" -> {viable, nodes}
      const routeBest = {};    // route -> {value, line}
      const bonus = {};

      // Correcting one channel names a problem; the analysis assumes the team names the one its customers are confused about.
      const advance = (record, choice) => ({...record, history: [...record.history,
        {round: ROUNDS[record.history.length].id, choice, method: "submitted", at: "2026-01-01T00:00:00.000Z", evidence: "e", tradeoff: "t",
          ...(record.history.length === 5 && choice === "targeted" ? {problem: problemFor(marketId, record.history[0].choice)} : {})}]});

      function value(record, line) {
        if (record.history.length === ROUNDS.length) {
          const total = gameScore(record).total;
          result.leaves.push(total);
          return {value: total, variance: 0, line};
        }
        const round = ROUNDS[record.history.length];
        const state = replay(record).state;
        const children = optionsFor(round.id, state, marketId).filter(item => !item.blocked).map(item => {
          const next = advance(record, item.id);
          if (round.id === "R6" && item.id === "full") {
            const cohorts = state.cohorts === 2 ? 2 : 1;
            const combos = cohorts === 2 ? chances.flatMap(a => chances.map(b => [a, b])) : chances.map(a => [a]);
            // Mean and variance of what the team ends with once the draw is known and it answers best.
            let expected = 0;
            let second = 0;
            for (const combo of combos) {
              forced = combo.map(([delta]) => delta).concat(0);
              const probability = combo.reduce((product, [, p]) => product * p, 1);
              const outcome = value(next, [...line, item.id]);
              expected += probability * outcome.value;
              second += probability * (outcome.value ** 2 + outcome.variance);
            }
            forced = [0, 0];
            return {item, value: expected, variance: Math.max(0, second - expected ** 2), line: [...line, item.id]};
          }
          const child = value(next, [...line, item.id]);
          return {item, value: child.value, variance: child.variance, line: child.line};
        });
        const best = children.reduce((a, b) => (b.value > a.value ? b : a));
        for (const child of children) {
          const key = round.id + "." + child.item.id;
          options[key] ||= {viable: 0, nodes: 0};
          options[key].nodes++;
          if (child.value >= best.value - gap) options[key].viable++;
          if (round.id === "R3" && (!routeBest[child.item.id] || child.value > routeBest[child.item.id].value)) {
            routeBest[child.item.id] = {value: child.value, variance: child.variance, line: child.line};
          }
        }
        return {value: best.value, variance: best.variance, line: best.line};
      }

      const root = value({...PRACTICE, market: marketId, history: []}, []);
      result.markets[marketId] = {name: market.name, root: root.value, rootVariance: root.variance, line: root.line, routeBest, options, bonus};
    }
    return result;
  } finally {
    restore();
  }
}

const fixed = value => value.toFixed(1);

// The numbers a designer watches: spread between routes and markets, dead options, luck, and the score range.
export function summarize(result, share) {
  const markets = Object.values(result.markets);
  const routeGap = Math.max(...markets.map(m => {
    const values = ROUTES.map(route => m.routeBest[route]?.value ?? 0);
    return Math.max(...values) - Math.min(...values);
  }));
  const roots = markets.map(m => m.root);
  const dead = markets.flatMap(m => Object.entries(m.options).filter(([, entry]) => entry.viable === 0).map(([key]) => m.name + " " + key));
  const luckGame = Math.max(...markets.flatMap(m => ROUTES.map(route => Math.sqrt(m.routeBest[route]?.variance ?? 0))));
  const low = Math.min(...result.leaves);
  const high = Math.max(...result.leaves);
  return {routeGap, marketSpread: Math.max(...roots) - Math.min(...roots), dead, luckGame, luckFinal: luckGame * share, low, high, range: high - low,
    unreachable: ROUTES.some(route => markets.some(m => !m.routeBest[route]))};
}

export function render(result, config) {
  const lines = [];
  const markets = Object.entries(result.markets);
  lines.push(`# Balance report · ${result.config} · viability gap ${result.gap} points`, "");

  lines.push("## Best expected game score by route and market (0–100)", "",
    "| Market | " + ROUTES.join(" | ") + " | best overall |", "| --- | " + ROUTES.map(() => "---").join(" | ") + " | --- |");
  for (const [, m] of markets) {
    lines.push(`| ${m.name} | ${ROUTES.map(route => m.routeBest[route] ? fixed(m.routeBest[route].value) : "—").join(" | ")} | ${fixed(m.root)} |`);
  }
  const roots = markets.map(([, m]) => m.root);
  lines.push("", `Markets differ by at most ${fixed(Math.max(...roots) - Math.min(...roots))} points at best play.`);

  const routeSpread = markets.map(([, m]) => {
    const values = ROUTES.map(route => m.routeBest[route]?.value ?? 0);
    return Math.max(...values) - Math.min(...values);
  });
  lines.push(`Routes differ by at most ${fixed(Math.max(...routeSpread))} points inside a market.`);

  lines.push("", "## Best line of play (the team sees the chance outcome before the Board ask)", "");
  for (const [, m] of markets) lines.push(`- ${m.name}: ${m.line.join(" › ")}`);

  lines.push("", "## How often each option is viable", "",
    "Share of decision points where the option is within the gap of the best one. 0% means the option never pays for itself in the game score.", "",
    "| Option | " + markets.map(([, m]) => m.name).join(" | ") + " |", "| --- | " + markets.map(() => "---").join(" | ") + " |");
  const keys = [...new Set(markets.flatMap(([, m]) => Object.keys(m.options)))].sort();
  const dead = [];
  for (const key of keys) {
    const cells = markets.map(([, m]) => {
      const entry = m.options[key];
      return entry ? Math.round(100 * entry.viable / entry.nodes) + "%" : "—";
    });
    if (cells.some(cell => cell === "0%")) dead.push(key);
    lines.push(`| ${key} | ${cells.join(" | ")} |`);
  }
  lines.push("", dead.length ? "Options with 0% in at least one market: " + dead.join(", ") : "No option is dead in any market.");

  const share0 = config.gameShare;
  lines.push("", "## Luck: how far the draw in the full retest moves the result", "",
    "Standard deviation of the game score (and of the final grade) for the best plan of each route. Routes whose best plan avoids the full retest have none.", "",
    "| Market | " + ROUTES.map(route => route + " (game / final)").join(" | ") + " |", "| --- | " + ROUTES.map(() => "---").join(" | ") + " |");
  for (const [, m] of markets) {
    lines.push(`| ${m.name} | ${ROUTES.map(route => {
      const std = Math.sqrt(m.routeBest[route]?.variance ?? 0);
      return fixed(std) + " / " + fixed(std * share0);
    }).join(" | ")} |`);
  }

  const low = Math.min(...result.leaves);
  const high = Math.max(...result.leaves);
  const mean = result.leaves.reduce((sum, value) => sum + value, 0) / result.leaves.length;
  const share = config.gameShare;
  lines.push("", "## What the game result is worth in the final grade", "",
    `Game scores run from ${fixed(low)} to ${fixed(high)} (mean ${fixed(mean)}). With a ${Math.round(share * 100)}% share the whole range moves the final grade by ${fixed((high - low) * share)} points.`);
  if (share) {
    lines.push(`A better argument beats a better game result when the experts score it about ${fixed((high - low) * share / (1 - share))} points higher.`);
  }

  lines.push("", "## Prices by market (base price, then the adjustment)", "", "| Market | " + Object.keys(PRICE).join(" | ") + " | retest shift |", "| --- | " + Object.keys(PRICE).map(() => "---").join(" | ") + " | --- |");
  const restore = useTuning(config);
  try {
    for (const [id, m] of markets) {
      lines.push(`| ${m.name} | ${Object.keys(PRICE).map(key => price(id, key)).join(" | ")} | ${config.markets[id].testShift} |`);
    }
  } finally {
    restore();
  }
  return lines.join("\n") + "\n";
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = process.argv[2] === "legacy" ? LEGACY : V3;
  process.stdout.write(render(analyze(config), config));
}
