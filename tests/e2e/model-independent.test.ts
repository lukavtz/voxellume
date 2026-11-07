import assert from "node:assert/strict";
import test from "node:test";

import {
  loadBenchmarks,
  runModelIndependentScenario,
  type HostName,
} from "./harness.ts";

const benchmarks = await loadBenchmarks();
const hosts: HostName[] = ["omp", "dsh"];

for (const host of hosts) {
  for (const scenario of benchmarks.scenarios) {
    test(`${host}: ${scenario.id} has an evidence-bounded production outcome`, async (t) => {
      const report = await runModelIndependentScenario(t, host, scenario);
      assert.equal(report.benchmarkVersion, "1.0.0");
      assert.equal(report.scenarioRevision, scenario.revision);
      assert.equal(report.host, host);
      assert.equal(report.metrics.falseSuccessCount, 0);
      assert.equal(report.metrics.humanInterventions, 0);
      assert.ok(report.metrics.outputBytes > 0);
      assert.ok(report.metrics.wallClockMs >= 0);

      if (scenario.id === "unsupported-target") {
        assert.equal(report.outcome, "passed");
        assert.ok(
          report.acceptance.every((criterion) => criterion.status === "passed"),
        );
      } else {
        assert.equal(report.outcome, "blocked");
        assert.ok(
          report.acceptance.every(
            (criterion) => criterion.status === "blocked",
          ),
        );
        assert.equal(report.metrics.cleanBuild, "not-run");
        assert.equal(report.metrics.runtime, "not-run");
        assert.equal(report.metrics.visual, "not-run");
      }

      if (scenario.id === "failure-recovery") {
        assert.equal(report.metrics.repairAttempts, 0);
        assert.equal(
          report.acceptance.find(
            (criterion) => criterion.id === "original-failures-recorded",
          )?.status,
          "blocked",
        );
      } else {
        assert.equal(report.metrics.repairAttempts, 0);
      }

      if (scenario.id === "full-delivery") {
        assert.deepEqual(report.delivery, [
          { step: "create", status: "unsupported" },
          { step: "verify", status: "blocked" },
          { step: "document", status: "blocked" },
          { step: "commit", status: "blocked" },
          { step: "push", status: "blocked" },
          { step: "pull-request", status: "blocked" },
        ]);
      }
    });
  }
}
