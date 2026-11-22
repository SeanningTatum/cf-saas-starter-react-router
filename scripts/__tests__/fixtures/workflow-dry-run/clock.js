export const meta = { name: 'clock', description: 'reaches for the clock or randomness when args.what asks' }

if (args.what === 'now') return Date.now()
if (args.what === 'new') return new Date().toISOString()
if (args.what === 'call') return Date()
if (args.what === 'random') return Math.random()
// A fixed date and the rest of Math stay available.
return { date: new Date('2026-01-01T00:00:00Z').toISOString(), utc: Date.UTC(2026, 0, 1), floor: Math.floor(2.5) }
