export const meta = { name: 'swallow', description: 'catches every agent throw, the way twice() and parallel() do' }

// args.schema: the schema the "try" call passes (none by default).
const schema = args && args.schema
let caught = 0
try {
  await agent('first', schema ? { label: 'try', schema } : { label: 'try' })
} catch {
  caught++
}
const [p] = await parallel([() => agent('second', { label: 'par' })])
return { caught, p }
