# Board de sunrise (GitHub Project 3)

https://github.com/users/devswert/projects/3 · Project id `PVT_kwHOAElJXs4Bnxoj`. El
item id (`PVTI_…`) sale de `item-list`.

| Campo | Field id | Opciones |
| --- | --- | --- |
| Status | `PVTSSF_lAHOAElJXs4BnxojzhmUrbc` | Shaping `40569a99` · Backlog `d698639f` · In progress `86ae6519` · Done `3705c55f` · Released `3006aa8c` |
| Priority | `PVTSSF_lAHOAElJXs4BnxojzhmUrkM` | P1 `fc8790b5` · P2 `27140585` · P3 `be86eeb9` |
| Size | `PVTSSF_lAHOAElJXs4BnxojzhmUrlI` | XS `5c75cdc0` · S `22b3cd5a` · M `cc95854b` · L `8efa8d8c` · XL `fc1915be` |

**Done** es "mezclada en `main`, esperando versión". **Released** es "salió en un
tag", y el milestone `vX.Y.Z` de la issue dice en cuál (lo pone `sunrise-release`).

Labels de área (uno por archivo de `docs/specs/`): `tareas`, `rituales`, `objetivos`,
`tiempo`, `calendario`, `mcp`, `ajustes`, `distribucion`, `ui`. Tipo: exactamente uno
de `enhancement` o `bug`. Origen, solo mientras está en Shaping: `triage` o
`to-complete`.

```bash
# Board
gh project item-list 3 --owner devswert --limit 100 --format json \
  | jq -r '.items[] | [.content.number, .status, .priority, .size, .id, .title] | @tsv'

# Cambiar un campo
gh project item-edit --project-id PVT_kwHOAElJXs4Bnxoj --id ITEM_ID \
  --field-id FIELD_ID --single-select-option-id OPTION_ID

# Body y labels (archivo temporal fuera del repo, en el scratchpad)
gh issue edit N --repo devswert/sunrise --body-file <scratchpad>/body.md \
  --add-label tareas --add-label enhancement --remove-label triage --remove-label to-complete

# Agregar al board
gh project item-add 3 --owner devswert --url https://github.com/devswert/sunrise/issues/N

# Sub-issues (gh no tiene flags: GraphQL)
gh api graphql -f query='{ repository(owner:"devswert", name:"sunrise") {
  issue(number: N) { parent { number } subIssuesSummary { total completed }
    subIssues(first: 50) { nodes { number title state } } } } }'
PARENT=$(gh api graphql -f query='{ repository(owner:"devswert", name:"sunrise") { issue(number: P) { id } } }' -q .data.repository.issue.id)
CHILD=$(gh api graphql -f query='{ repository(owner:"devswert", name:"sunrise") { issue(number: C) { id } } }' -q .data.repository.issue.id)
gh api graphql -f query='mutation($p:ID!,$c:ID!){ addSubIssue(input:{issueId:$p, subIssueId:$c}) { issue { number } } }' -f p="$PARENT" -f c="$CHILD"
```

Si `gh` falla por permisos del Project: pide `gh auth refresh -s project`.
