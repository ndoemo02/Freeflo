name: ChatOps Codemods

on:
  issue_comment:
    types: [created]          # start po dodaniu komentarza do issue/PR
  workflow_dispatch: {}       # oraz ręcznie z zakładki Actions

permissions:
  contents: write             # commit do repo (niezbędne przy braku zmian PR)
  pull-requests: write        # tworzenie PR
  issues: read                # czytanie treści komentarza

jobs:
  codemod:
    # odpalaj tylko na komentarze zaczynające się od /ui lub /ops
    if: >
      github.event_name == 'workflow_dispatch' ||
      (github.event_name == 'issue_comment' &&
       startsWith(github.event.comment.body, '/ui') ||
       startsWith(github.event.comment.body, '/ops'))
    runs-on: ubuntu-latest

    steps:
      - name: Checkout repo
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Parse command
        id: cmd
        run: |
          RAW="${{ github.event_name == 'issue_comment' && github.event.comment.body || 'workflow_dispatch' }}"
          # tylko pierwsza linia, bez CR
          CMD="$(printf "%s" "$RAW" | tr -d '\r' | head -n1)"
          echo "raw=$RAW"   >> "$GITHUB_OUTPUT"
          echo "cmd=$CMD"   >> "$GITHUB_OUTPUT"

      - name: Run codemod
        run: |
          echo "Running codemod with: '${{ steps.cmd.outputs.cmd }}'"
          node .github/scripts/codemod.js "${{ steps.cmd.outputs.cmd || '/ui help' }}"

      - name: Configure git (actor)
        run: |
          git config user.name  "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

      - name: Create branch if changes exist
        id: diff
        run: |
          if [ -n "$(git status --porcelain)" ]; then
            BR="chatops-${{ github.run_id }}"
            git checkout -b "$BR"
            git add -A
            git commit -m "chatops: apply ${{ steps.cmd.outputs.cmd }}"
            echo "branch=$BR" >> "$GITHUB_OUTPUT"
            echo "changed=true" >> "$GITHUB_OUTPUT"
          else
            echo "No changes produced by codemod."
            echo "changed=false" >> "$GITHUB_OUTPUT"
          fi

      - name: Push branch
        if: steps.diff.outputs.changed == 'true'
        run: |
          git push --set-upstream origin "${{ steps.diff.outputs.branch }}"

      - name: Create Pull Request
        if: steps.diff.outputs.changed == 'true'
        uses: peter-evans/create-pull-request@v5
        with:
          token: ${{ secrets.PAT_TOKEN }}     # <<— Personal Access Token (classic)
          branch: ${{ steps.diff.outputs.branch }}
          title: "ChatOps: ${{ steps.cmd.outputs.cmd }}"
          commit-message: "chatops: apply ${{ steps.cmd.outputs.cmd }}"
          body: |
            Automatyczny PR z ChatOps.
            **Komentarz:** `${{ steps.cmd.outputs.raw }}`
            **Run:** ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}
          labels: chatops, automated
          draft: false

      - name: No changes (skip PR)
        if: steps.diff.outputs.changed != 'true'
        run: echo "Codemod nie wprowadził zmian — PR pominięty."
