#!/usr/bin/env node

import process from "node:process"

import { main } from "./agent_review/cli.ts"

process.exitCode = await main()
