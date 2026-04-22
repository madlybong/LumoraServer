# Roadmap

## Near term

- polish the `bunx init @astrake/lumora` experience
- improve generated docs UI beyond the current simple dev page
- strengthen JWT validation and auth ergonomics
- improve query/filter validation and error reporting
- harden SQLite/MySQL CRUD behavior and schema creation
- add more runtime benchmarks

## Mid term

- richer resource hooks
- more configurable docs generation
- better parent-app extension points around auth and realtime
- stronger DB adapter seams without bloating the public API
- metadata and runtime hooks needed for a future Administrator UI

## Future product track

- Administrator UI
- resource management surfaces for admin users
- richer operational tooling around generated APIs
- more polished publishing and project scaffolding experience

## Guardrails

- keep the framework slim
- do not reintroduce removed jobs/worker architecture casually
- do not rebuild large package sprawl without strong justification
- keep `lumora.config.ts` and `routes/*.ts` as the primary mental model
- prefer concrete runtime value over speculative abstraction
