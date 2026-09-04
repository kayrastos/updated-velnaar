# VELNAR V1 scope lock

Scope revision: `velnar-v1-scope-1`. Contract version: `velnar-intelligence-contract-v1`.

## Core languages and frameworks

- TypeScript / JavaScript: Node.js + Express.
- Python: FastAPI.

## Closed vulnerability classes

1. SQL Injection (`SQL_INJECTION`).
2. OS Command Injection (`COMMAND_INJECTION`).
3. Server-Side Request Forgery / SSRF (`SSRF`).
4. Path Traversal / Arbitrary File Read (`PATH_TRAVERSAL`).
5. Object-Level Authorization Bypass / IDOR (`OBJECT_AUTHORIZATION`).

## Primary input and sensor direction

Git / SCM metadata; structural parser / Tree-sitter; framework semantic
extraction; Semgrep adapters; CodeQL/SARIF adapters; OSV dependency-context
adapters. These are scope declarations, not implementations in M0/M1.

## Exclusions that must not delay V1

Go; Java; broad DAST; CSPM/cloud posture; a generic AI Agent/MCP security
product; broad undefined business-logic security; a native frontier-scale VELNAR
model; an owned GPU cluster; autonomous production modification; auto-merge;
SOC 2 Type II; ISO 27001; full multi-region architecture; a full Security Digital
Twin. A scope addition requires an explicit, versioned scope revision and human
review, never a silent change to this list or benchmark answers.

## M0/M1 boundary

`worker/security` protects VELNAR's control plane. `worker/intelligence` defines
customer-code AppSec contracts; neither domain imports new behavior into the
other. This phase adds contracts and a metadata-only SQLi benchmark. It adds no
repository ingestion, Context Graph, AST/call graph/dataflow extraction,
reachability engine, scanner, Fulgor execution, real SQLi verification, Security
Memory, persistence, remediation, UI, deployment or commercial accuracy claims.

Candidate != verified vulnerability. AI reasoning and sensor summaries carry no
verification authority. Tenant identity and exact repository/snapshot/commit
binding are mandatory. A verification request is structured data, not permission
to execute arbitrary code. Future execution adapters must authenticate evidence
producers and enforce allowlisted profiles before using the contract gate.
