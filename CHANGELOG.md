# Changelog

All notable changes to ROMulus are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added — Phase 0 (scaffold)

**Project setup**
- Tauri v2 + React 19 + TypeScript + Vite scaffold
- Bundle identifier: `com.romulus.app`
- Window defaults: 1280×800, minimum 900×600

**Rust backend**
- All crates wired: `rusqlite`, `rusqlite_migration`, `walkdir`, `notify`, `trash`, `reqwest`,
  `ts-rs`, `quick-xml`, `zip`, `keyring`, `sentry`
- Tauri plugins registered: `fs`, `shell`, `dialog`, `notification`, `global-shortcut`, `updater`
- Tauri capabilities configured for filesystem read/write, watch, dialog, notifications, shortcuts

**Frontend**
- Tailwind CSS with dark gaming palette (CSS custom properties)
- shadcn/ui component library (18 components): Button, Badge, Card, Dialog, Table, Tabs,
  Tooltip, Separator, ScrollArea, Progress, Label, Checkbox, Switch, Select, Popover, Toast
- Dependencies: TanStack Query v5, TanStack Virtual v3, Zustand v5, Lucide React,
  Simple Icons, Radix UI primitives, Sentry React
- `@` path alias, `src/lib/utils.ts` (cn helper)

**Repository**
- BSL 1.1 — personal use free; commercial use requires license; converts to Apache 2.0 after 4 years
- PRIVACY.md, CLAUDE.md, README.md with badges
- GitHub Actions CI: Rust clippy + test, TypeScript type-check
- Public repo: https://github.com/Nyanez615/ROMulus
