// Optional wall-clock diagnostics; no changes to test execution or assertions.
export async function timed(name, action) {
  const start = performance.now();
  try { return await action(); }
  finally {
    if (process.env.TEST_TIMINGS) console.log(`TIME ${name}: ${((performance.now() - start) / 1000).toFixed(3)}s`);
  }
}
