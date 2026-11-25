import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("alpha-paper.json and alpha-ledger.json conform to Phase 4 Pure-Python Core3 schema", () => {
  const paper = JSON.parse(readFileSync("alpha-paper.json", "utf8"));
  const ledger = JSON.parse(readFileSync("alpha-ledger.json", "utf8"));

  assert.equal(paper.defaultMode, "ultra");
  assert.equal(paper.g1Verification?.allPassed, true);
  assert.ok(paper.g1Verification.passedCount >= 4);
  assert.ok(paper.tradingDaysInHistory >= 3000);
  assert.ok(paper.auctionsTracked >= 250);

  for (const mode of ["ultra", "enhanced"]) {
    const tk = paper.todayTickets?.[mode];
    assert.ok(tk, `Missing todayTickets.${mode}`);
    assert.ok(tk.execDate > tk.signalAsOfDate, `execDate must be strictly > signalAsOfDate (${tk.execDate} vs ${tk.signalAsOfDate})`);
    assert.ok(tk.valuationEndDate > tk.execDate, `valuationEndDate must be strictly > execDate`);
    assert.equal(tk.contracts.length, 4);
    for (const c of tk.contracts) {
      assert.ok(Number.isInteger(c.targetLots));
      assert.equal(c.pointValueUsd, c.leg === "TU" ? 2000 : 1000);
      assert.ok(c.refPrice > 50 && c.refPrice < 200);
    }
    const fwd = paper.forward?.[mode];
    assert.ok(fwd && fwd.totalSessionsLogged >= 1);
  }

  // Ledger append-only uniqueness: at most 1 frozen ticket per (execDate, mode)
  const keys = new Set();
  for (const e of ledger.entries) {
    const k = `${e.execDate}|${e.mode}`;
    assert.ok(!keys.has(k), `Duplicate frozen entry ${k}`);
    keys.add(k);
  }

  // Historical 10y OOS models present & zero-roll ETFs included
  assert.ok(paper.historical10yOos.models.ultra_50k.sharpe > 1.2);
  assert.ok(paper.historical10yOos.models.etf_open_50k.sharpe > 1.0);
  assert.ok(paper.historical10yOos.monthlyEquity.length >= 100);
});
