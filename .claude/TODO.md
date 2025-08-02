# FoundryVTT MCP Server - Action Items

## Critical Priority (Address Immediately)

### 🔴 Modernize Tool Routing System
**Location**: `src/tools/router.ts`, `src/tools/definitions.ts`  
**Effort**: Medium | **Impact**: High

**Tasks**:
- [ ] Create `Tool` interface with `name`, `schema`, and `execute` method
- [ ] Install and configure `ajv` JSON Schema validator
- [ ] Implement base `Tool` class with automatic validation
- [ ] Refactor each tool handler to extend `Tool` class
- [ ] Transform router from switch statement to registry pattern
- [ ] Update tool definitions to be consumed by new system
- [ ] Write migration tests to ensure compatibility

**Benefits**: Eliminates maintenance overhead, prevents runtime errors, simplifies adding new tools

### 🔴 Implement Request Caching
**Location**: `src/foundry/client.ts`, new `src/utils/cache.ts`  
**Effort**: Low | **Impact**: High

**Tasks**:
- [ ] Create `CacheService` class with TTL mechanism
- [ ] Implement cache wrapper for quasi-static methods:
  - [ ] `getWorldInfo()` - cache for 10 minutes
  - [ ] `getActor(id)` - cache for 5 minutes  
  - [ ] Rule lookups - cache for 30 minutes
- [ ] Use existing `config.cache` settings for configuration
- [ ] Add cache hit/miss logging for monitoring
- [ ] Implement cache clearing on errors/timeouts

**Benefits**: Significant performance improvement, reduced API load, better user experience

## High Priority (Next Sprint)

### 🟠 Enhance WebSocket Event System
**Location**: `src/foundry/client.ts:469-478`  
**Effort**: Low | **Impact**: High

**Tasks**:
- [ ] Replace `Map<string, Function>` with Node.js `EventEmitter`
- [ ] Update `onMessage()` method to use `emitter.on()`
- [ ] Support multiple listeners for same event type
- [ ] Add proper event cleanup in `disconnect()`
- [ ] Update message handling to emit typed events
- [ ] Write tests for event subscription/unsubscription

**Benefits**: More robust event handling, multiple listeners support, standard Node.js patterns

### 🟠 Add Pre-commit Quality Gates
**Location**: Root directory  
**Effort**: Low | **Impact**: Medium

**Tasks**:
- [ ] Install `husky` for git hooks
- [ ] Configure pre-commit hook to run:
  - [ ] `npm run lint`
  - [ ] `npm run test`
  - [ ] `npm run check-types`
- [ ] Add pre-push hook for E2E tests (optional)
- [ ] Update documentation with contribution workflow

**Benefits**: Automatic quality enforcement, prevents broken commits, maintains code standards

## Medium Priority (Next Month)

### 🟡 Formalize Connection Strategy Pattern
**Location**: `src/foundry/client.ts`  
**Effort**: Medium | **Impact**: Medium

**Tasks**:
- [ ] Create `ConnectionStrategy` interface with methods:
  - [ ] `rollDice()`, `searchActors()`, `searchItems()`, `getScene()`, etc.
- [ ] Implement `RestApiStrategy` class
- [ ] Implement `WebSocketStrategy` class with fallback logic
- [ ] Refactor `FoundryClient` to use strategy delegation
- [ ] Update configuration to select strategy at construction
- [ ] Write strategy-specific tests

**Benefits**: Cleaner architecture, easier testing, better separation of concerns

### 🟡 Improve Error Handling Specificity
**Location**: `src/foundry/client.ts`, `src/tools/handlers/`  
**Effort**: Low | **Impact**: Medium

**Tasks**:
- [ ] Create custom error classes:
  - [ ] `RestApiNotAvailableError`
  - [ ] `ActorNotFoundError`
  - [ ] `InvalidDiceFormulaError`
  - [ ] `AuthenticationFailedError`
- [ ] Replace generic `throw new Error()` with specific errors
- [ ] Update error handlers to catch specific types
- [ ] Add error context information (request details, etc.)

**Benefits**: Better error debugging, more specific error handling, improved user experience

### 🟡 Document API Dependencies
**Location**: `README.md`, new `COMPATIBILITY.md`  
**Effort**: Low | **Impact**: Medium

**Tasks**:
- [ ] Create compatibility matrix for:
  - [ ] FoundryVTT versions (v11, v12, etc.)
  - [ ] "Foundry Local REST API" module versions
  - [ ] Node.js versions
- [ ] Document known issues and workarounds
- [ ] Add troubleshooting section for version mismatches
- [ ] Include upgrade/downgrade guidance

**Benefits**: Manages user expectations, aids troubleshooting, reduces support burden

## Long-term Strategic (Next Quarter)

### 🟢 Plugin Architecture Development
**Location**: New `src/plugins/` directory  
**Effort**: High | **Impact**: High

**Tasks**:
- [ ] Design Plugin Interface with lifecycle methods
- [ ] Create plugin registry and discovery system
- [ ] Implement plugin loading and hot-reload capabilities
- [ ] Add plugin sandboxing for security
- [ ] Create plugin development documentation
- [ ] Build example plugins for common use cases
- [ ] Design community marketplace structure

**Benefits**: Community extensibility, reduced core complexity, ecosystem growth

### 🟢 Configuration Profiles System
**Location**: `src/config/`, new profile management  
**Effort**: Medium | **Impact**: Medium

**Tasks**:
- [ ] Extend configuration to support named profiles
- [ ] Add profile switching without server restart
- [ ] Implement profile validation and migration
- [ ] Create CLI commands for profile management
- [ ] Add bulk operations across multiple profiles
- [ ] Document multi-instance deployment patterns

**Benefits**: Power user support, enterprise deployment, better scalability

### 🟢 Enhanced Observability
**Location**: `src/utils/logger.ts`, new metrics system  
**Effort**: Medium | **Impact**: Medium

**Tasks**:
- [ ] Implement structured JSON logging format
- [ ] Add Prometheus-compatible metrics endpoint
- [ ] Create performance dashboards with Grafana templates
- [ ] Implement alert system for critical issues
- [ ] Add request tracing and correlation IDs
- [ ] Monitor memory usage and connection health

**Benefits**: Production monitoring, performance optimization, proactive issue detection

## Quick Wins (Immediate)

### ⚡ Formalize Contribution Guidelines
**Location**: Move from `README.md` to `CONTRIBUTING.md`  
**Effort**: Very Low | **Impact**: Low

**Tasks**:
- [ ] Create dedicated `CONTRIBUTING.md` file
- [ ] Document development workflow and PR process
- [ ] Add code style guidelines and review criteria
- [ ] Include testing requirements and standards

### ⚡ Memory Usage Monitoring
**Location**: `src/utils/diagnostics.ts`  
**Effort**: Low | **Impact**: Low

**Tasks**:
- [ ] Add memory usage tracking to health checks
- [ ] Implement memory leak detection alerts
- [ ] Monitor long-running session resource usage
- [ ] Add garbage collection metrics

### ⚡ Investigate Socket.io-client Migration
**Location**: `src/foundry/client.ts` WebSocket implementation  
**Effort**: High | **Impact**: High (Long-term)

**Tasks**:
- [ ] Research socket.io-client compatibility with FoundryVTT
- [ ] Create proof-of-concept implementation
- [ ] Performance testing vs current WebSocket approach
- [ ] Migration plan if beneficial

## Technical Debt Backlog

### Development Environment
- [ ] Add Docker development environment
- [ ] Implement development database seeding
- [ ] Create integration test fixtures
- [ ] Add performance benchmarking suite

### Code Quality
- [ ] Increase test coverage to 95%+
- [ ] Add mutation testing with Stryker
- [ ] Implement bundle size monitoring
- [ ] Add accessibility testing for web components

### Documentation
- [ ] Create video tutorials for setup
- [ ] Add architecture decision records (ADRs)
- [ ] Generate API documentation website
- [ ] Create troubleshooting decision tree

### Security
- [ ] Add security scanning to CI/CD
- [ ] Implement dependency vulnerability monitoring
- [ ] Add rate limiting for API endpoints
- [ ] Create security review checklist

---

## Progress Tracking

**Critical Items Completed**: 0/2  
**High Priority Completed**: 0/2  
**Medium Priority Completed**: 0/3  
**Quick Wins Completed**: 0/2  

**Next Review Date**: February 15, 2025  
**Overall Progress**: 0% (0/9 priority items)

---

*Last Updated: January 2025*  
*Based on comprehensive analysis of codebase version 0.10.0*