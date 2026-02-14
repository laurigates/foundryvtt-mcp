# Document Management

## Automatic Document Detection

When conversations reveal significant decisions or requirements, prompt for document creation:

- **Architecture decisions** with trade-offs -> suggest `/blueprint:derive-adr`
- **Feature requirements** with acceptance criteria -> suggest `/blueprint:derive-prd`
- **Implementation plans** with steps -> suggest `/blueprint:prp-create`

## Document Locations

- PRDs: `docs/prds/` - Product Requirements Documents
- ADRs: `docs/adrs/` - Architecture Decision Records
- PRPs: `docs/prps/` - Product Requirement Prompts

## Naming Conventions

- Use kebab-case for all document filenames
- ADRs: `NNNN-description.md` (e.g., `0001-socket-io-auth.md`)
- PRDs: `feature-name.md`
- PRPs: `task-name.md`
