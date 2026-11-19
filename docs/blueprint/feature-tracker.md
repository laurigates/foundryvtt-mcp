# Feature Tracker

**Interpretation:** statuses reflect the **MCP surface exposed by the current source**, not every operation Foundry VTT itself supports. See the [source-verified capability matrix](../guides/capabilities.md) for tool-by-tool evidence and transport restrictions.

| Feature | PRD | Status | Priority |
| --- | --- | --- | --- |
| Socket.IO authentication (4-step flow) | PRD-001 | implemented | high |
| World state snapshot + document update broadcasts | PRD-001 | implemented (requires re-sync after missed updates) | high |
| Dice rolling (restricted portable notation) | PRD-001 | implemented (advanced modifiers unsupported) | high |
| Actor search and detail retrieval | PRD-001 | implemented (summary fields) | high |
| Actor system attribute editing | PRD-001 | implemented (not full Actor/character-sheet CRUD) | medium |
| World item search | PRD-001 | implemented | medium |
| Compendium search | PRD-001 | implemented (REST module only, read-only) | medium |
| Scene information | PRD-001 | implemented (read-only) | medium |
| Scene navigation/switching and scene editing | PRD-001 | not exposed | medium |
| Journal search and retrieval | PRD-001 | implemented (page excerpts truncated) | medium |
| Create journal entries | PRD-001 | implemented (write gate) | low |
| Edit/delete existing journals | PRD-001 | not exposed | low |
| Combat state and initiative tracking | PRD-001 | implemented | medium |
| Combat management (start, next turn, set initiative, end) | PRD-001 | implemented (four tools; limited scope) | high |
| Token movement and status effects | PRD-001 | implemented (two write tools) | medium |
| Other token or scene-canvas CRUD | PRD-001 | not exposed | medium |
| Owned actor-item create/update/delete | PRD-001 | implemented (inline create, no compendium-source create) | medium |
| User presence and recent chat messages | PRD-001 | implemented (read-only) | medium |
| World search by names | PRD-001 | implemented (not document-body full text) | medium |
| World summary and snapshot refresh | PRD-001 | implemented (Socket.IO cache dependent) | medium |
| NPC generation | PRD-001 | implemented (text only, no Actor creation) | low |
| Loot generation | PRD-001 | implemented (text only, fixed item suggestions) | low |
| Actual rules database lookup | PRD-001 | stub only; no lookup | low |
| MCP resource endpoints (`foundry://`) | PRD-001 | implemented (9 resources) | medium |
| Optional REST diagnostics (logs and health) | PRD-002 | implemented (`diagnose_errors` is a stub) | low |
| Macro execution | PRD-001 | not exposed | low |
| Multi-world support | PRD-001 | not exposed | low |
| ThreeHats REST API Relay integration | — | not implemented | to be determined |

**Write safety:** `FOUNDRY_WRITE_ENABLED=true` plus authenticated Socket.IO and GM/owner permissions are required. `FOUNDRY_API_KEY` selects a separate REST mode in the current client; it does not enable the write tools.
