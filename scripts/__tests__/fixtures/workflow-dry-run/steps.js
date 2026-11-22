export const meta = {
  name: 'steps',
  description: 'one agent call per step, in order',
  phases: [{ title: 'Run' }],
}

// args.steps: [{ prompt, opts? }]; opts defaults to { label: prompt }.
phase('Run')
const out = []
for (const s of args.steps) out.push(await agent(s.prompt, s.opts || { label: s.prompt }))
log(`ran ${out.length}`)
return out
