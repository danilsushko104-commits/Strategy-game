import { fileURLToPath, pathToFileURL } from 'node:url';
import { CONFIG, MARKETS, ROUNDS } from '../src/scenario.mjs';
import { optionsFor, replay, gameScore, price, PRICE } from '../src/rules.mjs';
import { LEGACY, PROPOSAL, useTuning } from '../src/tuning.mjs';

// Balance report for a tuning set. The game is a decision tree with one point of chance (the full retest),
// so every choice is valued as a team would value it: the best option at each decision, the average over
// chance. An option is "viable" at a node when its value is within `gap` points of the best option there.
//
//   node scripts/balance.mjs            evaluate the PROPOSAL
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

      const advance = (record, choice) => ({...record, history: [...record.history,
        {round: ROUNDS[record.history.length].id, choice, method: "submitted", at: "2026-01-01T00:00:00.000Z", evidence: "e", tradeoff: "t"}]});

      function value(record, line) {
        if (record.history.length === ROUNDS.length) {
          const total = gameScore(record).total;
          result.leaves.push(total);
          return {value: total, line};
        }
        const round = ROUNDS[record.history.length];
        const state = replay(record).state;
        const children = optionsFor(round.id, state, marketId).filter(item => !item.blocked).map(item => {
          const next = advance(record, item.id);
          if (round.id === "R6" && item.id === "full") {
            const cohorts = state.cohorts === 2 ? 2 : 1;
            const combos = cohorts === 2 ? chances.flatMap(a => chances.map(b => [a, b])) : chances.map(a => [a]);
            let expected = 0;
            for (const combo of combos) {
              forced = combo.map(([delta]) => delta).concat(0);
              const probability = combo.reduce((product, [, p]) => product * p, 1);
              expected += probability * value(next, [...line, item.id]).value;
            }
            forced = [0, 0];
            return {item, value: expected, line: [...line, item.id]};
          }
          const child = value(next, [...line, item.id]);
          return {item, value: child.value, line: child.line};
        });
        const best = children.reduce((a, b) => (b.value > a.value ? b : a));
        for (const child of children) {
          const key = round.id + "." + child.item.id;
          options[key] ||= {viable: 0, nodes: 0};
          options[key].nodes++;
          if (child.value >= best.value - gap) options[key].viable++;
          if (round.id === "R3" && (!routeBest[child.item.id] || child.value > routeBest[child.item.id].value)) {
            routeBest[child.item.id] = {value: child.value, line: child.line};
          }
        }
        return {value: best.value, line: best.line};
      }

      const root = value({...PRACTICE, market: marketId, history: []}, []);
      result.markets[marketId] = {name: market.name, root: root.value, line: root.line, routeBest, options, bonus};
    }
    return result;
  } finally {
    restore();
  }
}

const fixed = value => value.toFixed(1);

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
  const config = process.argv[2] === "legacy" ? LEGACY : PROPOSAL;
  process.stdout.write(render(analyze(config), config));
}
