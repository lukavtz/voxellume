import assert from "node:assert/strict";
import test from "node:test";

import {
  repairVerification,
  type RepairVerificationOptions,
} from "../../src/core/verification/repair.ts";

const publicCheck = {
  id: "build:item-registration",
  acceptanceHash: "a".repeat(64),
} as const;

type CheckOutcome = "passed" | "failed" | "throw";

function harness(outcomes: readonly CheckOutcome[]) {
  const events: string[] = [];
  const observedChecks: unknown[] = [];
  const observedFailures: unknown[] = [];
  let state = "last-verified";

  const options: RepairVerificationOptions = {
    check: publicCheck,
    runCheck: async ({ attempt, check }) => {
      events.push(`check:${attempt}`);
      observedChecks.push(check);
      assert.equal(
        state,
        attempt === 0 ? "last-verified" : `changed:${attempt}`,
      );
      const outcome = outcomes[attempt] ?? "failed";
      if (outcome === "throw") {
        throw new Error(`check ${attempt} exploded`);
      }
      return {
        check: { ...publicCheck },
        status: outcome,
        evidence: { checkAttempt: attempt },
      };
    },
    applyChange: async ({ attempt, failure }) => {
      events.push(`apply:${attempt}`);
      observedFailures.push(failure);
      assert.equal(state, "last-verified");
      state = `changed:${attempt}`;
      return {
        diff: `vertical-diff:${attempt}`,
        evidence: { changeAttempt: attempt },
      };
    },
    restore: async ({ attempt }) => {
      events.push(`restore:${attempt}`);
      assert.equal(state, `changed:${attempt}`);
      state = "last-verified";
    },
  };

  return {
    options,
    events,
    observedChecks,
    observedFailures,
    state: () => state,
  };
}

test("an immediately passing public check performs no edit or restore", async () => {
  const fixture = harness(["passed"]);

  const result = await repairVerification(fixture.options);

  assert.equal(result.status, "passed");
  assert.equal(result.originalFailure, null);
  assert.deepEqual(result.attempts, []);
  assert.deepEqual(fixture.events, ["check:0"]);
  assert.equal(fixture.state(), "last-verified");
});

test("an initial pass cannot change check identity or acceptance hash", async (t) => {
  for (const field of ["id", "acceptanceHash"] as const) {
    await t.test(field, async () => {
      const fixture = harness(["passed"]);
      const runCheck: RepairVerificationOptions["runCheck"] = async (
        context,
      ) => {
        const result = await fixture.options.runCheck(context);
        return {
          ...result,
          check: {
            ...result.check,
            [field]: field === "id" ? "build:substituted" : "b".repeat(64),
          },
        };
      };

      const result = await repairVerification({
        ...fixture.options,
        runCheck,
      });

      assert.equal(result.status, "failed");
      assert.equal(result.originalFailure, null);
      assert.deepEqual(result.attempts, []);
      assert.deepEqual(fixture.events, ["check:0"]);
      assert.equal(fixture.state(), "last-verified");
    });
  }
});

test("a failure makes one vertical change and reruns the identical public check", async () => {
  const fixture = harness(["failed", "passed"]);

  const result = await repairVerification(fixture.options);

  assert.equal(result.status, "passed");
  assert.deepEqual(fixture.events, ["check:0", "apply:1", "check:1"]);
  assert.deepEqual(fixture.observedChecks, [publicCheck, publicCheck]);
  assert.deepEqual(fixture.observedFailures, [result.originalFailure]);
  assert.deepEqual(result.attempts, [
    {
      attempt: 1,
      change: {
        diff: "vertical-diff:1",
        evidence: { changeAttempt: 1 },
      },
      check: {
        check: { ...publicCheck },
        status: "passed",
        evidence: { checkAttempt: 1 },
      },
    },
  ]);
});

test("repair can succeed on attempts one, two, and three", async (t) => {
  for (const successfulAttempt of [1, 2, 3] as const) {
    await t.test(`attempt ${successfulAttempt}`, async () => {
      const outcomes: CheckOutcome[] = Array.from(
        { length: successfulAttempt + 1 },
        (_, attempt) => (attempt === successfulAttempt ? "passed" : "failed"),
      );
      const fixture = harness(outcomes);

      const result = await repairVerification(fixture.options);

      assert.equal(result.status, "passed");
      assert.equal(result.attempts.length, successfulAttempt);
      assert.equal(
        fixture.events.filter((event) => event.startsWith("check:")).length,
        successfulAttempt + 1,
      );
      assert.equal(
        fixture.events.filter((event) => event.startsWith("apply:")).length,
        successfulAttempt,
      );
      assert.equal(
        fixture.events.filter((event) => event.startsWith("restore:")).length,
        successfulAttempt - 1,
      );
      assert.equal(fixture.state(), `changed:${successfulAttempt}`);
    });
  }
});

test("default and oversized attempt limits never run a fourth repair", async (t) => {
  for (const maxAttempts of [undefined, 3, 99] as const) {
    await t.test(`maxAttempts=${String(maxAttempts)}`, async () => {
      const fixture = harness(["failed"]);
      const options = {
        ...fixture.options,
        ...(maxAttempts === undefined ? {} : { maxAttempts }),
      };

      const result = await repairVerification(options);

      assert.equal(result.status, "failed");
      assert.equal(result.attempts.length, 3);
      assert.deepEqual(fixture.events, [
        "check:0",
        "apply:1",
        "check:1",
        "restore:1",
        "apply:2",
        "check:2",
        "restore:2",
        "apply:3",
        "check:3",
        "restore:3",
      ]);
      assert.equal(fixture.state(), "last-verified");
    });
  }
});

test("each failed attempt restores before the next change or final result", async () => {
  const fixture = harness(["failed", "failed", "failed", "passed"]);

  const result = await repairVerification(fixture.options);

  assert.equal(result.status, "passed");
  assert.deepEqual(fixture.events, [
    "check:0",
    "apply:1",
    "check:1",
    "restore:1",
    "apply:2",
    "check:2",
    "restore:2",
    "apply:3",
    "check:3",
  ]);
  assert.equal(fixture.state(), "changed:3");
});

test("an applyChange exception restores last verified state without retrying", async () => {
  const fixture = harness(["failed", "passed"]);
  const applyChange: RepairVerificationOptions["applyChange"] = async (
    context,
  ) => {
    await fixture.options.applyChange(context);
    throw new Error("apply exploded");
  };

  const result = await repairVerification({
    ...fixture.options,
    applyChange,
  });

  assert.equal(result.status, "failed");
  assert.deepEqual(fixture.events, ["check:0", "apply:1", "restore:1"]);
  assert.equal(fixture.state(), "last-verified");
  assert.equal(result.originalFailure?.evidence.checkAttempt, 0);
});

test("a rerun check exception restores last verified state without retrying", async () => {
  const fixture = harness(["failed", "throw", "passed"]);

  const result = await repairVerification(fixture.options);

  assert.equal(result.status, "failed");
  assert.deepEqual(fixture.events, [
    "check:0",
    "apply:1",
    "check:1",
    "restore:1",
  ]);
  assert.equal(fixture.state(), "last-verified");
  assert.equal(result.originalFailure?.evidence.checkAttempt, 0);
});

test("cancellation after a vertical change restores before returning", async () => {
  const controller = new AbortController();
  const fixture = harness(["failed", "passed"]);
  const applyChange: RepairVerificationOptions["applyChange"] = async (
    context,
  ) => {
    const change = await fixture.options.applyChange(context);
    controller.abort();
    return change;
  };

  const result = await repairVerification({
    ...fixture.options,
    applyChange,
    signal: controller.signal,
  });

  assert.equal(result.status, "cancelled");
  assert.deepEqual(fixture.events, ["check:0", "apply:1", "restore:1"]);
  assert.equal(fixture.state(), "last-verified");
  assert.equal(result.attempts[0]?.change?.diff, "vertical-diff:1");
});

test("a restore failure returns recovery_required and stops repair", async () => {
  const fixture = harness(["failed", "failed", "passed"]);
  const restore: RepairVerificationOptions["restore"] = async () => {
    throw new Error("restore exploded");
  };

  const result = await repairVerification({
    ...fixture.options,
    restore,
  });

  assert.equal(result.status, "recovery_required");
  assert.deepEqual(fixture.events, ["check:0", "apply:1", "check:1"]);
  assert.equal(fixture.state(), "changed:1");
  assert.equal(result.originalFailure?.evidence.checkAttempt, 0);
  assert.equal(result.attempts[0]?.change?.diff, "vertical-diff:1");
});

test("the original failure and every vertical diff and evidence record survive exhaustion", async () => {
  const fixture = harness(["failed"]);

  const result = await repairVerification(fixture.options);

  assert.equal(result.status, "failed");
  assert.deepEqual(result.originalFailure, {
    check: { ...publicCheck },
    status: "failed",
    evidence: { checkAttempt: 0 },
  });
  assert.deepEqual(
    result.attempts.map((attempt) => ({
      attempt: attempt.attempt,
      diff: attempt.change?.diff,
      changeEvidence: attempt.change?.evidence,
      checkEvidence: attempt.check?.evidence,
    })),
    [1, 2, 3].map((attempt) => ({
      attempt,
      diff: `vertical-diff:${attempt}`,
      changeEvidence: { changeAttempt: attempt },
      checkEvidence: { checkAttempt: attempt },
    })),
  );
});

test("a retry cannot change check identity or acceptance hash", async (t) => {
  for (const field of ["id", "acceptanceHash"] as const) {
    await t.test(field, async () => {
      const fixture = harness(["failed", "passed", "passed"]);
      const runCheck: RepairVerificationOptions["runCheck"] = async (
        context,
      ) => {
        const result = await fixture.options.runCheck(context);
        if (context.attempt !== 1) {
          return result;
        }
        return {
          ...result,
          check: {
            ...result.check,
            [field]: field === "id" ? "build:substituted" : "b".repeat(64),
          },
        };
      };

      const result = await repairVerification({
        ...fixture.options,
        runCheck,
      });

      assert.equal(result.status, "failed");
      assert.deepEqual(fixture.events, [
        "check:0",
        "apply:1",
        "check:1",
        "restore:1",
      ]);
      assert.equal(fixture.state(), "last-verified");
      assert.equal(
        result.originalFailure?.check.acceptanceHash,
        "a".repeat(64),
      );
    });
  }
});
