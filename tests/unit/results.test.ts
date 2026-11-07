import assert from "node:assert/strict";
import test from "node:test";

import {
  domainFailure,
  domainSuccess,
  serializeDomainResult,
} from "../../src/core/results.ts";

const sha256 =
  "9b2e18a69c684e429f52ef93dc829b865b4e2986a6a21ea57a2c77a84ab15e21";
const evidence = {
  path: "evidence/transaction-1/build.log",
  sha256,
  checkId: "build-clean",
};

test("domainSuccess returns the exact versioned envelope and preserves value and evidence", () => {
  const value = { modId: "ruby_blade", accepted: true };
  const result = domainSuccess(value, [evidence]);

  assert.deepEqual(result, {
    schemaVersion: "domain-result-1.0.0",
    status: "ok",
    value,
    evidence: [evidence],
  });
  assert.equal(result.value, value);
  assert.equal(result.evidence[0], evidence);
  assert.deepEqual(domainSuccess("ok"), {
    schemaVersion: "domain-result-1.0.0",
    status: "ok",
    value: "ok",
    evidence: [],
  });
});

test("domainFailure returns the exact error envelope without inventing retryability", () => {
  const result = domainFailure({
    code: "verification_failed",
    detail: "Clean build failed",
    retryable: false,
    details: { exitCode: 1, attempt: 2 },
    evidence: [evidence],
  });

  assert.deepEqual(result, {
    schemaVersion: "domain-result-1.0.0",
    status: "error",
    error: {
      code: "verification_failed",
      detail: "Clean build failed",
      retryable: false,
      details: { exitCode: 1, attempt: 2 },
    },
    evidence: [evidence],
  });
  assert.deepEqual(
    domainFailure({
      code: "unsupported_target",
      detail: "No qualified target pack",
      retryable: false,
    }),
    {
      schemaVersion: "domain-result-1.0.0",
      status: "error",
      error: {
        code: "unsupported_target",
        detail: "No qualified target pack",
        retryable: false,
      },
      evidence: [],
    },
  );
});

test("serializeDomainResult uses canonical key order and preserves evidence check IDs", () => {
  assert.equal(
    serializeDomainResult(domainSuccess({ z: 1, a: "first" }, [evidence])),
    '{"evidence":[{"checkId":"build-clean","path":"evidence/transaction-1/build.log","sha256":"9b2e18a69c684e429f52ef93dc829b865b4e2986a6a21ea57a2c77a84ab15e21"}],"schemaVersion":"domain-result-1.0.0","status":"ok","value":{"a":"first","z":1}}',
  );

  const failure = domainFailure({
    code: "build_failed",
    detail: "Compilation failed",
    retryable: true,
    details: { task: "build", exitCode: 1 },
    evidence: [evidence],
  });
  assert.equal(
    serializeDomainResult(failure),
    '{"error":{"code":"build_failed","detail":"Compilation failed","details":{"exitCode":1,"task":"build"},"retryable":true},"evidence":[{"checkId":"build-clean","path":"evidence/transaction-1/build.log","sha256":"9b2e18a69c684e429f52ef93dc829b865b4e2986a6a21ea57a2c77a84ab15e21"}],"schemaVersion":"domain-result-1.0.0","status":"error"}',
  );
});

test("helpers reject invalid programmer inputs with TypeError", () => {
  const invalidEvidence = [
    { ...evidence, sha256: "abc" },
    { ...evidence, sha256: sha256.toUpperCase() },
    { ...evidence, sha256: `g${sha256.slice(1)}` },
  ];

  for (const item of invalidEvidence) {
    assert.throws(() => domainSuccess(null, [item]), TypeError);
    assert.throws(
      () =>
        domainFailure({
          code: "build_failed",
          detail: "Compilation failed",
          retryable: false,
          evidence: [item],
        }),
      TypeError,
    );
  }

  for (const code of ["", "   "]) {
    assert.throws(
      () => domainFailure({ code, detail: "Failure", retryable: false }),
      TypeError,
    );
  }
  for (const detail of ["", "   "]) {
    assert.throws(
      () => domainFailure({ code: "build_failed", detail, retryable: false }),
      TypeError,
    );
  }

  assert.throws(
    () =>
      domainFailure({
        code: "build_failed",
        detail: "Compilation failed",
        retryable: false,
        details: new Error("raw errors are not JSON-safe") as never,
      }),
    TypeError,
  );
});
