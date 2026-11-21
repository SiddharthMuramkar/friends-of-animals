export const meta = {
  name: 'foa-review',
  description: 'Cold review of one foa-factory PR head: Standards, Spec+skeptic, and Security for risk units',
  phases: [{ title: 'Review' }],
}
const obj = (p, req) => ({ type: 'object', properties: p, required: req || Object.keys(p) })
const Str = { type: 'string' }, Int = { type: 'integer' }
const FINDING = obj({ severity: { enum: ['blocking', 'minor'] }, area: Str, file: Str, problem: Str, evidence: Str, fix: Str })
const VERDICT = obj({
  verdict: { enum: ['pass', 'fail'] },
  findings: { type: 'array', items: FINDING },
  summary: Str,
  acs: { type: 'array', items: obj({ index: Int, text: Str, status: Str, evidence: Str }, ['index', 'text', 'status']) },
}, ['verdict', 'findings', 'summary'])

const { unit, issue, title, milestone, branch, sha, risk, siblings = [], round = 1, base = null } = args
const DIR = '/root/foa-work/factory/prompts'
const input = { unit, issue, title, milestone, branch, sha, risk, siblings, round, ...(base ? { base } : {}) }
const P = (role) => `Read ${DIR}/rules.md and ${DIR}/review-${role}.md in full (it points you to ${DIR}/review-common.md too), then follow them exactly with this input:\n${JSON.stringify(input, null, 1)}\n` +
  (base ? `This PR is stacked: diff against foa/${base} (three dots, i.e. its merge-base), not foa/${milestone}. Review only this unit's own commits; the base unit is reviewed separately.\n` : '') +
  'You are a Workflow stage agent: read-only reviewer, never edit, commit, push or post; never start agents; return only the structured verdict.'
const roles = ['standards', 'spec', ...(risk ? ['security'] : [])]
const runs = await parallel(roles.map((r) => async () => {
  let v = await agent(P(r), { label: `${unit}:review-${r}`, phase: 'Review', schema: VERDICT, effort: 'xhigh' })
  if (!v) v = await agent(P(r), { label: `${unit}:review-${r}-retry`, phase: 'Review', schema: VERDICT, effort: 'xhigh' })
  return v ? { role: r, ...v } : { role: r, verdict: 'error', findings: [], summary: 'reviewer agent failed twice' }
}))
const blocking = runs.flatMap((v) => (v.findings || []).filter((f) => f.severity === 'blocking').map((f) => ({ role: v.role, ...f })))
const errored = runs.filter((v) => v.verdict === 'error').map((v) => v.role)
const pass = !errored.length && blocking.length === 0
log(`${unit} @ ${sha.slice(0, 8)} round ${round}: ${pass ? 'PASS' : errored.length ? 'ERROR ' + errored : 'FAIL ' + blocking.length + ' blocking'}`)
return { unit, sha, round, pass, errored, blocking, reviews: runs }
