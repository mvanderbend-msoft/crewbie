# Evaluation gate

Agreed in the deploy plan (#28) and finished in #36 after the review.

## Flow

1. A push to `main` starts `.github/workflows/deploy.yml`.
2. The `evaluate` job signs in with OIDC (environment `production`), builds the image to prove it builds, starts the host on the runner with `uv run python main.py`, and runs `evals/run.py` against `http://localhost:8088` with the commit SHA as agent version.
3. Results and the host log are uploaded as the `eval-results-<sha>` artifact, also on failure.
4. The `deploy` job `needs: evaluate` and has no `if:` override, so it only runs when every metric meets `evals/thresholds.json`. It then runs `azd deploy concierge`.

## Why the host runs outside the container

DefaultAzureCredential inside `docker run` has no access to the runner's Azure sign-in, and passing a token into the container would put a credential in the job environment. The image is still built in the same job, so a broken Dockerfile fails the gate.

## Identities

- The deploy identity has Foundry Project Manager on the project, Azure AI User for the safety evaluators, and Search Index Data Reader on the search service so the local host can answer policy questions.
- The deployed agent uses its own Entra agent identity, granted by `scripts/grant-agent-access.sh`.

## Changing thresholds

`evals/thresholds.json` and `deploy.yml` are owned by `@contoso/travel-concierge-leads` in CODEOWNERS. Raising a threshold needs a reason in the PR; lowering one needs a decision recorded here first. There is no skip input: the review of #36 removed it, and an emergency rollback redeploys an earlier commit through the same gate.
