import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { CONFIG, MARKETS, ROUNDS, SOURCES, PROBLEMS, SINGAPORE } from '../src/scenario.mjs';
import { optionsFor, replay, price, PRICE, problemFor, OUTCOMES } from '../src/rules.mjs';
import { tuning, useTuning } from '../src/tuning.mjs';
import { analyze } from './balance.mjs';

// The decision map: what a team can choose in each round, what it costs in each market, what unlocks or
// blocks what, and how the story differs by market and profile. It is generated from the game itself, so it
// cannot drift from it.   node scripts/decision-map.mjs   →   docs/decision-map.md

const OUTPUT = new URL("../docs/decision-map.md", import.meta.url);
const WHEN = "2026-01-01T00:00:00.000Z";
const names = Object.keys(MARKETS);
const cell = text => String(text ?? "").replaceAll("|", "\\|").replace(/\s+/g, " ").trim();
const table = (header, rows) => ["| " + header.join(" | ") + " |", "| " + header.map(() => "---").join(" | ") + " |", ...rows.map(row => "| " + row.map(cell).join(" | ") + " |")].join("\n");

// Walk the whole tree of a market (all three outcomes of the chance in the full retest) and collect facts.
function explore(marketId) {
  const reasons = {};     // "R5.broaden" -> Set of the reasons the game gives when it is unavailable
  const requests = {};    // R7 menus -> number of endings
  const labels = {};
  let paths = 0;
  let forced = 0;
  const original = tuning();
  const restore = useTuning({...original, randomness: {...original.randomness, draw: () => forced}});
  try {
    const walk = record => {
      const round = ROUNDS[record.history.length];
      if (!round) { paths++; return; }
      const state = replay(record).state;
      const options = optionsFor(round.id, state, marketId);
      if (round.id === "R7") {
        const menu = options.filter(item => !item.blocked).map(item => item.id).sort().join(" + ");
        requests[menu] = (requests[menu] || 0) + 1;
      }
      for (const item of options) {
        labels[round.id + "." + item.id] = item.label;
        if (item.blocked && !/^Needs \d/.test(item.blocked)) (reasons[round.id + "." + item.id] ||= new Set()).add(item.blocked);
        if (item.blocked) continue;
        const problem = round.id === "R6" && item.id === "targeted" ? {problem: problemFor(marketId, record.history[0].choice)} : {};
        walk({...record, history: [...record.history, {round: round.id, choice: item.id, method: "submitted", at: WHEN, evidence: "e", tradeoff: "t", ...problem}]});
      }
    };
    for (const delta of [-1, 0, 1]) {
      forced = delta;
      walk({game: CONFIG.game, version: CONFIG.version, mode: "practice", team: 1, market: marketId, room: "PRACTICE", session: "map", drafts: {}, notes: {}, brief: "", bulletinB: true, history: []});
    }
  } finally {
    restore();
  }
  return {reasons, requests, labels, paths};
}

export function buildMap() {
  const explored = Object.fromEntries(names.map(id => [id, explore(id)]));
  const settings = tuning();
  const balance = analyze(settings);
  const out = [];
  const line = (text = "") => out.push(text);

  line("# Карта решений One Market First");
  line();
  line("Документ создаётся командой `node scripts/decision-map.mjs` из самой игры, поэтому он совпадает с кодом. Тексты игры на английском, пояснения на русском. Нужен автору и специалисту по финтеху, чтобы проверить, что история, решения и география согласованы.");
  line();
  line(`Настройки: **${settings.name}** · бюджет ${CONFIG.budget} кредитов · итог = ${Math.round((1 - settings.gameShare) * 100)}% экспертов + ${Math.round(settings.gameShare * 100)}% игрового результата · случайность ±1 в полном тесте с вероятностью ${Math.round(settings.randomness.retestSpread * 100)}% в каждую сторону.`);
  line();

  line("## 1. Как устроено дерево");
  line();
  line("Семь раундов, в каждом команда выбирает одну карту. Выбор влияет на доступность и цену следующих карт. Что от чего зависит:");
  line();
  line(table(["Раунд", "Что выбирают", "Что это открывает или меняет дальше"], [
    ["R1 Customer", "Профиль клиента A или B (бесплатно)", "От профиля зависят все тексты: сигнал клиентов, ход конкурента, кризис. Механика у профилей одинаковая."],
    ["R2 Evidence", "Досье · интервью · прототип", "Даёт текст-доказательство. Прототип добавляет +1 к позднему полному тесту. Остальные последствия только в игровом результате."],
    ["R3 Entry route", "Пилот · альянс · сделка (M&A)", "Определяет маршрут. От него зависят карты R5 (второй канал только у альянса, проверка сделки только у сделки) и запросы в R7."],
    ["R4 Readiness", "Резерв · проверка готовности", "Проверка делает точечное исправление бесплатным, полный тест дешевле на 1 и служит доказательством для точечного исправления."],
    ["R5 Competition", "Оставить · сузить · второй канал (альянс) · проверка сделки (сделка)", "Сужение даёт тест на 5 человек и доказательство, полный тест после него даёт 18/20. Второй канал даёт вторую группу. Проверка сделки нужна для запроса по сделке."],
    ["R6 Emergency", "Пауза · исправление одного канала (+ какая проблема) · исправление всех каналов с повторным тестом", "Точечное исправление доказано только если названа та проблема, о которой спрашивают клиенты профиля, и есть проверка R4 или сужение R5. Полный тест: порог 16 из 20 на группу, результат колеблется на ±1."],
    ["R7 Board", "Запрос к совету", "Какие запросы доступны, см. раздел 3."]
  ]));
  line();

  line("## 2. Цены по рынкам (в кредитах)");
  line();
  line("Базовая цена и надбавка рынка. Различия нейтральны по бюджету: удешевление одного шага компенсируется удорожанием другого. Сдвиг результата полного теста у Таиланда −1 (проходить порог труднее).");
  line();
  const restore = useTuning(settings);
  try {
    line(table(["Карта", "База", ...names.map(id => MARKETS[id].name)], Object.keys(PRICE).map(key => [key, PRICE[key], ...names.map(id => {
      const value = price(id, key);
      return value === PRICE[key] ? value : `**${value}** (${value > PRICE[key] ? "+" : ""}${value - PRICE[key]})`;
    })])));
  } finally {
    restore();
  }
  line();
  line(table(["Рынок", "Сдвиг теста", "Почему рынки различаются (гипотеза, требует проверки)"], names.map(id => [MARKETS[id].name, settings.markets[id].testShift, settings.markets[id].note])));
  line();

  line("## 3. Когда карта недоступна (как это формулирует игра)");
  line();
  line("Собрано обходом всего дерева. «Needs N credits» (не хватает кредитов) не показано.");
  line();
  const allKeys = [...new Set(names.flatMap(id => Object.keys(explored[id].reasons)))].sort();
  line(table(["Карта", "Название", "Причина недоступности"], allKeys.map(key => {
    const reasons = [...new Set(names.flatMap(id => [...(explored[id].reasons[key] ?? [])]))];
    const label = names.map(id => explored[id].labels[key]).find(Boolean);
    return [key, label, reasons.join(" · ")];
  })));
  line();
  line("Запросы к совету в конце: " + Object.entries(OUTCOMES).map(([id, [title]]) => `\`${id}\` = ${title}`).join("; ") + ".");
  line();

  line("## 4. Размер дерева и исходы");
  line();
  line("Число завершённых цепочек решений (для трёх исходов теста в сумме) и меню R7 в конце:");
  line();
  const menus = [...new Set(names.flatMap(id => Object.keys(explored[id].requests)))].sort();
  line(table(["Рынок", "Цепочек", ...menus.map(menu => "R7: " + menu)], names.map(id => [MARKETS[id].name, explored[id].paths, ...menus.map(menu => explored[id].requests[menu] ?? 0)])));
  line();
  line("Лучший ожидаемый игровой результат по маршрутам (0–100), расчёт `node scripts/balance.mjs`:");
  line();
  line(table(["Рынок", "Пилот", "Альянс", "Сделка", "Лучшая линия"], names.map(id => {
    const market = balance.markets[id];
    return [market.name, ...["pilot", "alliance", "acquisition"].map(route => market.routeBest[route]?.value.toFixed(1) ?? "—"), market.line.join(" › ")];
  })));
  line();

  line("## 5. Общая основа: Сингапур");
  line();
  for (const [label, value] of SINGAPORE) line(`- **${label}.** ${value}`);
  line();

  line("## 6. Рынки подробно");
  for (const id of names) {
    const market = MARKETS[id];
    line();
    line(`### ${market.name} · ${market.city} · ${market.currency}`);
    line();
    for (const [label, value] of market.facts) line(`- **${label}.** ${value}`);
    line("- **Источники:** " + market.sources.map(source => `[${SOURCES[source][0]}](${SOURCES[source][1]})`).join("; "));
    line();
    line("**Маршруты (кандидаты):**");
    line();
    line(table(["Маршрут", "Кандидат", "Что известно"], Object.entries(market.candidates).map(([route, [name, detail]]) => [route, name, detail])));
    line();
    line(`**Проверка сделки (R5):** ${market.diligence}`);
    for (const [key, profile] of Object.entries(market.profiles)) {
      line();
      line(`#### Профиль ${key}: ${profile.name}`);
      line();
      line(`- **Путь клиента.** ${profile.journey}`);
      line(`- **Канал.** ${profile.channel}`);
      line("- **Альтернативы:** " + profile.alternatives.map(([name, detail, link]) => `[${name}](${link}) — ${detail}`).join(" · "));
      line(`- **R2 сигнал.** ${profile.signal}`);
      line(`- **R2 интервью (2 кр.).** ${profile.interview}`);
      line(`- **R2 прототип (3 кр.).** ${profile.prototype}`);
      line(`- **R4 проверка готовности.** ${profile.review}`);
      line(`- **R5 ход конкурента.** ${profile.competitor}`);
      line(`- **R5 сужение.** ${profile.narrow}`);
      line(`- **R6 кризис.** ${profile.incident}`);
      line("- **R6 какую проблему нужно назвать:** " + profile.problems.map(problem => PROBLEMS.find(item => item.id === problem).label).join(" или "));
    }
  }
  line();

  line("## 7. Сравнение рынков по раундам");
  line();
  line("Один и тот же шаг в разных рынках и профилях: видно, где тексты различаются по сути, а где только по названиям.");
  const compare = [
    ["R2 сигнал клиентов", "signal"], ["R2 интервью", "interview"], ["R2 прототип", "prototype"], ["R4 проверка готовности", "review"],
    ["R5 ход конкурента", "competitor"], ["R5 сужение", "narrow"], ["R6 кризис", "incident"]
  ];
  for (const [title, field] of compare) {
    line();
    line(`### ${title}`);
    line();
    line(table(["Рынок · профиль", "Текст"], names.flatMap(id => Object.entries(MARKETS[id].profiles).map(([key, profile]) => [`${MARKETS[id].name} · ${key} (${profile.name})`, profile[field]]))));
  }
  line();
  return out.join("\n") + "\n";
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await writeFile(OUTPUT, buildMap(), "utf8");
  console.log("docs/decision-map.md");
}
export { OUTPUT };
