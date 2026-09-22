const fs = require('node:fs');
function validate(env) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(env.ARTIFACT_PREFIX ?? ''))
    throw Error('Invalid release artifact prefix.');
  if (
    !/^\d+$/.test(env.RETENTION_DAYS ?? '') ||
    Number(env.RETENTION_DAYS) < 1 ||
    Number(env.RETENTION_DAYS) > 90
  )
    throw Error('Artifact retention must be between 1 and 90 days.');
}
function result(env) {
  validate(env);
  const attempt = [1, 2, 3].find((n) => env['OUTCOME_' + n] === 'success');
  if (!attempt)
    throw Error(
      'GitHub did not finalize the requested artifact after three upload attempts. Delivery has failed. Re-run the failed job after checking GitHub Actions availability; do not weaken signing or token permissions.',
    );
  const id = env['ID_' + attempt],
    address = env['URL_' + attempt],
    run = env.GITHUB_RUN_ID,
    runAttempt = env.GITHUB_RUN_ATTEMPT;
  if (!/^\d+$/.test(id ?? '') || !/^\d+$/.test(run ?? '') || !/^\d+$/.test(runAttempt ?? ''))
    throw Error('GitHub did not return a valid finalized artifact ID.');
  let url, server;
  try {
    url = new URL(address);
    server = new URL(env.GITHUB_SERVER_URL ?? 'https://github.com');
  } catch {
    throw Error('GitHub did not return an artifact download URL.');
  }
  if (
    url.protocol !== 'https:' ||
    url.origin !== server.origin ||
    url.username ||
    url.password ||
    url.hash ||
    url.search ||
    url.pathname !== `/${env.GITHUB_REPOSITORY}/actions/runs/${run}/artifacts/${id}`
  )
    throw Error('Unexpected artifact download URL.');
  return {
    id,
    url: url.href,
    name: `${env.ARTIFACT_PREFIX}-${run}-${runAttempt}-try${attempt}`,
    attempt,
  };
}
function main(env = process.env, command = process.argv[2]) {
  validate(env);
  if (command === 'validate') return;
  if (command !== 'report') throw Error('Unknown artifact reporting command.');
  let artifact;
  try {
    artifact = result(env);
  } catch (error) {
    if (env.GITHUB_STEP_SUMMARY)
      fs.appendFileSync(
        env.GITHUB_STEP_SUMMARY,
        `### ${env.ARTIFACT_PREFIX} delivery failed\n\nGitHub did not confirm a usable artifact. The job remains failed; no download link is claimed. Review the upload steps and service status before rerunning the failed job. Signing checks and token permissions were not relaxed.\n`,
      );
    throw error;
  }
  if (!env.GITHUB_OUTPUT || !env.GITHUB_STEP_SUMMARY)
    throw Error('GitHub output files are unavailable.');
  fs.appendFileSync(
    env.GITHUB_OUTPUT,
    `artifact-id=${artifact.id}\nartifact-url=${artifact.url}\nartifact-name=${artifact.name}\n`,
  );
  fs.appendFileSync(
    env.GITHUB_STEP_SUMMARY,
    `### ${env.ARTIFACT_PREFIX}\n\n[Download ${artifact.name}](${artifact.url})\n\nFinalized on upload attempt ${artifact.attempt}. Only successful finalization is reported as delivery.\n`,
  );
  console.log(`Artifact finalized on attempt ${artifact.attempt}: ${artifact.url}`);
}
module.exports = { validate, result, main };
if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error('::error::' + error.message);
    process.exitCode = 1;
  }
}
