#!/usr/bin/env node

import process from "node:process"

import { main } from "./agent_review/cli.ts"

const FORCE_EXIT_MS = 10_000

process.exitCode = await main()
// Lets agentex finish its own kill escalation, then stops a reviewer process that outlived its closed session from keeping the helper running.
// agentex sessions neither guarantee process exit on close nor expose the pid: https://github.com/dynamismlabs/agentex/issues/8
setTimeout(() => process.exit(), FORCE_EXIT_MS).unref()
