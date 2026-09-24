import { PLANNING_LABEL } from "../config.js";

export function planningWorkflow(setup: string, enabled: boolean): string {
  return `name: Crewbie planning
on:
${enabled ? "  issues:\n    types: [labeled]\n" : ""}  workflow_dispatch:
    inputs:
      pr:
        description: Open planning PR to revise
        required: true
        type: string
      feedback:
        description: Specific changes requested (one paid revision, reusing context)
        required: true
        type: string
      head:
        description: Expected PR head (set by crewbie revise-plan)
        required: false
        type: string
      source:
        description: Current source fingerprint (set by crewbie revise-plan)
        required: true
        type: string
permissions:
  contents: read
concurrency:
  group: crewbie-planning-\${{ github.event.issue.number || inputs.pr || github.run_id }}
  cancel-in-progress: false
jobs:
  prepare:
    if: \${{ (github.event_name == 'issues' && github.event.label.name == '${PLANNING_LABEL}') || github.event_name == 'workflow_dispatch' }}
    runs-on: ubuntu-latest
    timeout-minutes: 3
    permissions:
      actions: read
      contents: read
      issues: read
      pull-requests: read
    outputs:
      ready: \${{ steps.context.outputs.ready }}
      model: \${{ steps.context.outputs.model }}
    steps:
${setup}      - name: Verify ready label and prepare coordinator context
        id: context
        env:
          GH_TOKEN: \${{ github.token }}
        run: node "$RUNNER_TEMP/crewbie/node_modules/@crewbie/cli/dist/cli.js" internal-plan --prepare
      - uses: actions/upload-artifact@v7.0.1
        if: \${{ steps.context.outputs.ready == 'true' }}
        with:
          name: crewbie-planning-input
          include-hidden-files: true
          retention-days: 1
          path: |
            .crewbie-planning-input.json
            .crewbie-planning-prompt.txt
          if-no-files-found: error
  analyze:
    needs: prepare
    if: \${{ needs.prepare.outputs.ready == 'true' }}
    runs-on: ubuntu-latest
    timeout-minutes: 9
    permissions:
      copilot-requests: write
    steps:
      - uses: actions/setup-node@v7.0.0
        with:
          node-version: '22'
      - uses: actions/download-artifact@v8.0.1
        with:
          name: crewbie-planning-input
      - name: Run named coordinator planning
        env:
          GITHUB_TOKEN: \${{ github.token }}
          CREWBIE_PLANNING_MODEL: \${{ needs.prepare.outputs.model }}
          CREWBIE_COPILOT_VERSION: \${{ vars.CREWBIE_COPILOT_VERSION }}
        run: |
          [[ "$CREWBIE_COPILOT_VERSION" =~ ^[0-9]+\\.[0-9]+\\.[0-9]+([.-][A-Za-z0-9.-]+)?$ ]] || { echo "Set an approved exact Copilot CLI version."; exit 1; }
          test -n "$CREWBIE_PLANNING_MODEL" || { echo "Approve an explicit planning model."; exit 1; }
          npm install --prefix "$RUNNER_TEMP/copilot" --no-audit --no-fund "@github/copilot@$CREWBIE_COPILOT_VERSION"
          "$RUNNER_TEMP/copilot/node_modules/.bin/copilot" --model "$CREWBIE_PLANNING_MODEL" --no-custom-instructions --disable-builtin-mcps --available-tools --silent --deny-tool shell write url --prompt "$(cat .crewbie-planning-prompt.txt)" > .crewbie-planning-output.txt
      - uses: actions/upload-artifact@v7.0.1
        with:
          name: crewbie-planning-output
          include-hidden-files: true
          retention-days: 1
          path: .crewbie-planning-output.txt
          if-no-files-found: error
  publish:
    needs: [prepare, analyze]
    runs-on: ubuntu-latest
    timeout-minutes: 3
    permissions:
      actions: read
      contents: write
      issues: read
      pull-requests: write
    steps:
${setup}      - uses: actions/download-artifact@v8.0.1
        with:
          name: crewbie-planning-input
      - uses: actions/download-artifact@v8.0.1
        with:
          name: crewbie-planning-output
      - name: Validate and publish planning PR only
        env:
          GH_TOKEN: \${{ github.token }}
        run: node "$RUNNER_TEMP/crewbie/node_modules/@crewbie/cli/dist/cli.js" internal-plan --apply
`;
}

export function executionWorkflow(setup: string, enabled: boolean): string {
  return `name: Crewbie execute approved plan
on:
${enabled ? "  pull_request_target:\n    types: [closed]\n" : ""}  workflow_dispatch:
    inputs:
      pr:
        description: Merged planning PR number to verify and resume
        required: true
        type: string
permissions:
  contents: read
concurrency:
  group: crewbie-plan-release-\${{ github.event.pull_request.number || inputs.pr }}
  cancel-in-progress: false
jobs:
  release:
    if: \${{ github.event_name == 'workflow_dispatch' || (github.event.pull_request.merged == true && github.event.pull_request.head.repo.full_name == github.repository && startsWith(github.event.pull_request.head.ref, 'crewbie/plans/')) }}
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
${setup}      - name: Verify human approval and merge, publish tasks and dispatch
        env:
          GH_TOKEN: \${{ secrets.CREWBIE_USER_TOKEN }}
          CREWBIE_ADO_TOKEN: \${{ secrets.CREWBIE_ADO_TOKEN }}
          PR_NUMBER: \${{ github.event.pull_request.number || inputs.pr }}
        run: |
          test -n "$GH_TOKEN" || { echo "Configure a supported user-authorized CREWBIE_USER_TOKEN for native cloud assignment. No credential fallback is used."; exit 1; }
          node "$RUNNER_TEMP/crewbie/node_modules/@crewbie/cli/dist/cli.js" internal-release-plan --pr "$PR_NUMBER"
`;
}

export function reviewWorkflow(setup: string): string {
  return `name: Crewbie review
run-name: "Crewbie review PR #\${{ inputs.pr }} at \${{ inputs.head }}"
# Dispatch requests one run per PR head. The PR's code is never checked out; the reviewer reads its API diff.
on:
  workflow_dispatch:
    inputs:
      pr:
        description: PR number to review
        required: true
        type: string
      head:
        description: PR head SHA to review
        required: true
        type: string
permissions:
  contents: read
concurrency:
  group: crewbie-review-\${{ inputs.pr }}
  cancel-in-progress: false
jobs:
  prepare:
    runs-on: ubuntu-latest
    timeout-minutes: 3
    permissions:
      contents: read
      issues: read
      pull-requests: read
    outputs:
      ready: \${{ steps.context.outputs.ready }}
      model: \${{ steps.context.outputs.model }}
    steps:
${setup}      - name: Prepare reviewer context
        id: context
        env:
          GH_TOKEN: \${{ github.token }}
          PR_NUMBER: \${{ inputs.pr }}
          HEAD_SHA: \${{ inputs.head }}
        run: node "$RUNNER_TEMP/crewbie/node_modules/@crewbie/cli/dist/cli.js" internal-review --prepare
      - uses: actions/upload-artifact@v7.0.1
        if: \${{ steps.context.outputs.ready == 'true' }}
        with:
          name: crewbie-review-input
          include-hidden-files: true
          retention-days: 1
          path: |
            .crewbie-review-input.json
            .crewbie-review-prompt.txt
          if-no-files-found: error
  analyze:
    needs: prepare
    if: \${{ needs.prepare.outputs.ready == 'true' }}
    runs-on: ubuntu-latest
    timeout-minutes: 9
    permissions:
      copilot-requests: write
    steps:
      - uses: actions/setup-node@v7.0.0
        with:
          node-version: '22'
      - uses: actions/download-artifact@v8.0.1
        with:
          name: crewbie-review-input
      - name: Run the Crewbie reviewer
        env:
          GITHUB_TOKEN: \${{ github.token }}
          CREWBIE_REVIEW_MODEL: \${{ needs.prepare.outputs.model }}
          CREWBIE_COPILOT_VERSION: \${{ vars.CREWBIE_COPILOT_VERSION }}
        run: |
          [[ "$CREWBIE_COPILOT_VERSION" =~ ^[0-9]+\\.[0-9]+\\.[0-9]+([.-][A-Za-z0-9.-]+)?$ ]] || { echo "Set an approved exact Copilot CLI version."; exit 1; }
          test -n "$CREWBIE_REVIEW_MODEL" || { echo "Approve an explicit reviewer model."; exit 1; }
          npm install --prefix "$RUNNER_TEMP/copilot" --no-audit --no-fund "@github/copilot@$CREWBIE_COPILOT_VERSION"
          "$RUNNER_TEMP/copilot/node_modules/.bin/copilot" --model "$CREWBIE_REVIEW_MODEL" --no-custom-instructions --disable-builtin-mcps --available-tools --silent --deny-tool shell write url --prompt "$(cat .crewbie-review-prompt.txt)" > .crewbie-review-output.txt
      - uses: actions/upload-artifact@v7.0.1
        with:
          name: crewbie-review-output
          include-hidden-files: true
          retention-days: 1
          path: .crewbie-review-output.txt
          if-no-files-found: error
  publish:
    needs: [prepare, analyze]
    runs-on: ubuntu-latest
    timeout-minutes: 3
    permissions:
      actions: write
      contents: read
      issues: write
      pull-requests: write
    steps:
${setup}      - uses: actions/download-artifact@v8.0.1
        with:
          name: crewbie-review-input
      - uses: actions/download-artifact@v8.0.1
        with:
          name: crewbie-review-output
      - name: Post the review comment
        env:
          GH_TOKEN: \${{ github.token }}
        run: node "$RUNNER_TEMP/crewbie/node_modules/@crewbie/cli/dist/cli.js" internal-review --apply
      - name: Ask dispatch to act on the verdict
        env:
          GH_TOKEN: \${{ github.token }}
          REPOSITORY: \${{ github.repository }}
          BRANCH: \${{ github.event.repository.default_branch }}
        run: gh workflow run crewbie-dispatch.yml --repo "$REPOSITORY" --ref "$BRANCH"
`;
}