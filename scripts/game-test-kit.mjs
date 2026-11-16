import { makeRoom, marketForTable, TEAMS } from '../src/rules.mjs';

// Helpers for browser tests of the hosted game: the facilitator's side done through the sheet's own web address,
// so that a test can set a game up in one call and then look at what a player's page does.

export function hostApi(base, token) {
  const url = base.replace(/\/?$/, "/") + "sheets";
  const post = async body => (await fetch(url, {method: "POST", body: JSON.stringify({v: 1, ...body})})).json();
  const get = async query => (await fetch(url + "?" + new URLSearchParams(query))).json();
  const api = {
    post, get,
    form: () => post({type: "form", token}),
    // `international` (true or false) fixes the kind of every demo player; left out, the sheet draws it.
    demo: (count, international) => post({type: "demo", token, count, ...(international === undefined ? {} : {international})}),
    roster: () => get({action: "roster", token}),
    me: id => get({action: "me", id}),
    captain: id => post({type: "captain", id}),
    reset: () => post({type: "reset", token}),
    // R1 opens `minutesAgo` minutes ago (negative: in the future), so a test can be in any part of the seminar.
    async start(minutesAgo = 0) {
      const startAt = Math.floor((Date.now() - minutesAgo * 60_000) / 60_000) * 60_000;
      const room = makeRoom(startAt, Math.floor(Math.random() * 24), "TST");
      const reply = await post({type: "start", token, room, start: new Date(startAt).toISOString(), markets: TEAMS.map(team => marketForTable(room, team))});
      return reply.ok ? {...reply, room, startAt} : reply;
    },
    // Draws the teams again until the predicate holds for the roster (for example "these two people share a team").
    async formUntil(predicate, attempts = 60) {
      for (let attempt = 0; attempt < attempts; attempt++) {
        const roster = await api.form();
        if (!roster.ok) throw new Error(roster.error);
        if (await predicate(roster)) return roster;
      }
      throw new Error("The draw never satisfied the condition.");
    }
  };
  return api;
}
