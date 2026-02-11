function updateOctokitInstance(github) {
  updateGithubRestActions(github);
  addConvenienceMethods(github);
}

function addConvenienceMethods(github) {
  Object.assign(github, {
    // checks if a run is a failure from the perspective of sending Slack
    // notifications. Works for both runs and run attempts, which should be the
    // same object shapes.
    // When a run has not been completed, it fetches the jobs for the workflow
    // to check if the job is "failing" instead of "failed".
    async isFailedRun(run) {
      console.log(`checking run: ${run.id}`);
      console.log(`status: ${run.status}`);
      console.log(`conclusion: ${run.conclusion}`);
      console.log(`run_attempt: ${run.run_attempt}`);

      if (run.status === 'completed') {
        console.log('completed -- checking conclusion');
        return run.conclusion === 'failure' || run.conclusion === 'timed_out';
      }

      const owner = run.repository.owner.login;
      const repo = run.repository.name;
      const jobsResp = await github.rest.actions.listJobsForWorkflowRun({
        owner,
        repo,
        run_id: run.id,
      });

      console.log('checking jobs');
      const jobs = jobsResp.data;
      for (const job of jobs.jobs) {
        if (job.conclusion === 'failure' || job.conclusion === 'timed_out') {
          console.log('job failed');
          return true;
        } else if (job.status === 'completed') {
          continue;
        }

        for (const step of job.steps) {
          if (step.conclusion === 'failure') {
            console.log('job step failed');
            return true;
          }
        }
      }

      return false;
    },
  });
}

// github-script's Octokit/REST plugins are out of date, so we have to
// add our own custom endpoint method
// see https://octokit.github.io/rest.js/v18#custom-endpoint-methods for
// documentation
function updateGithubRestActions(github) {
  Object.assign(github.rest.actions, {
    getWorkflowRunAttempt: github.request.defaults({
      method: 'GET',
      url: '/repos/{owner}/{repo}/actions/runs/{run_id}/attempts/{attempt_number}',
      params: {
        owner: {
          required: true,
          type: 'string',
        },
        repo: {
          required: true,
          type: 'string',
        },
        run_id: {
          required: true,
          type: 'number',
        },
        attempt_number: {
          required: true,
          type: 'number',
        },
      },
    }),
  });
}

// Returns  { current: 'failure' } | { current: 'success', previous: 'success' | 'failure' } to indicate the failure status
// of the current and previous runs
module.exports = async ({ github }) => {
  const { GITHUB_REPOSITORY, GITHUB_RUN_ID, GITHUB_REF_NAME } = process.env;
  const [owner, repo] = GITHUB_REPOSITORY.split('/');
  updateOctokitInstance(github);

  const workflowRunResp = await github.rest.actions.getWorkflowRun({
    owner,
    repo,
    run_id: GITHUB_RUN_ID,
  });

  const currentRun = workflowRunResp.data;
  const listWorkflowRunsResp = await github.rest.actions.listWorkflowRuns({
    owner,
    repo,
    workflow_id: currentRun.workflow_id,
    branch: GITHUB_REF_NAME,
  });
  const { workflow_runs } = listWorkflowRunsResp.data;

  if (workflow_runs.length === 1 && workflow_runs[0].run_attempt === 1) {
    return false;
  }

  const previousRuns = workflow_runs.filter(
    (run) => run.status === 'completed' && run.conclusion !== 'cancelled'
  );

  if (await github.isFailedRun(currentRun)) {
    return { current: 'failure', previous: null };
  }

  if (currentRun.run_attempt === 1 && previousRuns.length > 0) {
    return {
      current: 'success',
      previous: (await github.isFailedRun(previousRuns[0])) ? 'failure' : 'success',
    };
  }

  for (let i = currentRun.run_attempt - 1; i > 0; i--) {
    const previousAttemptResp = await github.rest.actions.getWorkflowRunAttempt({
      owner,
      repo,
      run_id: currentRun.id,
      attempt_number: i,
    });
    const previousAttempt = previousAttemptResp.data;
    if (
      previousAttempt.conclusion === 'success' ||
      previousAttempt.conclusion === 'failure' ||
      previousAttempt.conclusion === 'timed_out'
    ) {
      return {
        current: 'success',
        previous: (await github.isFailedRun(previousAttempt)) ? 'failure' : 'success',
      };
    }
  }

  if (previousRuns.length > 0) {
    return {
      current: 'success',
      previous: (await github.isFailedRun(previousRuns[0])) ? 'failure' : 'success',
    };
  }

  return { current: 'success', previous: 'success' };
};
