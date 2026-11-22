export const meta = { name: 'fanout', description: 'parallel and pipeline with one throw each' }

const p = await parallel([
  () => agent('one', { label: 'p1' }),
  () => {
    throw new Error('boom')
  },
  () => agent('three', { label: 'p3' }),
])
const q = await pipeline(
  [1, 2, 3],
  (prev, item, i) => {
    if (item === 2) throw new Error('stage 1 threw')
    return prev * 10
  },
  (prev, item, i) => ({ prev, item, i }),
)
return { p, q }
