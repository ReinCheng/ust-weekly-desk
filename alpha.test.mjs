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
      assert.ok(Number.isInteger(c.prevTargetLots));
      assert.equal(c.deltaLots, c.targetLots - c.prevTargetLots);
      assert.ok(c.refDate <= tk.signalAsOfDate, `refDate ${c.refDate} must be <= signalAsOfDate ${tk.signalAsOfDate} (no overnight T+0 leak)`);
      assert.equal(c.pointValueUsd, c.leg === "TU" ? 2000 : 1000);
      assert.ok(c.refPrice > 50 && c.refPrice < 200);
      assert.ok(typeof c.unwindHint === "string" && c.unwindHint.length > 0);
    }
    assert.ok(tk.lifecycle?.actionSummary?.verdict);
    assert.ok(tk.lifecycle?.pillars?.eom);
    assert.ok(tk.lifecycle?.pillars?.curve5s30s);
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

  // Glass-Box Explainability Bundle
  assert.ok(paper.explain, "Missing explain bundle");
  assert.equal(paper.explain.curves.s2s10s.history15d.length, 15);
  assert.equal(paper.explain.curves.s5s30s.history15d.length, 15);
  for (const mode of ["ultra", "enhanced"]) {
    const m = paper.explain.modes[mode];
    assert.ok(m, `Missing explain.modes.${mode}`);
    assert.equal(m.raw_w.length, 3);
    assert.ok(m.damper_details.damper >= 0.35 && m.damper_details.damper <= 1.0);
    assert.equal(m.pillar_leg_dv01.P2_EOM.length, 4);
    assert.equal(m.pillar_leg_dv01.P5c_5s30s.length, 4);
  }

  // Cloud Daily Post-Close Briefings archive
  const briefings = JSON.parse(readFileSync("alpha-briefings.json", "utf8"));
  assert.ok(Array.isArray(briefings.entries) && briefings.entries.length >= 1);
  assert.equal(briefings.latestAsOfDate, paper.panelAsOfDate);
  assert.ok(briefings.ideaCatalog.length >= 12);
  const latestBrief = briefings.entries[0];
  assert.ok(latestBrief.regimeDiagnosis?.volRegime);
  assert.ok(latestBrief.reviews?.ultra);
  assert.ok(latestBrief.nextAction?.ultra?.actionSummary?.verdict);
  assert.ok(latestBrief.researchSpotlight?.title);
});
